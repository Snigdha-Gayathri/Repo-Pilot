// ---------------------------------------------------------------------------
// LangGraph StateGraph construction — RepoPilot AI multi-agent pipeline
//
// Nodes:    7 agents + 2 checkpoint pauses
// Edges:    conditional routing with retry loops
// Saver:    PostgresSaver (persistent across serverless invocations)
// ---------------------------------------------------------------------------
import { StateGraph, START, END } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Pool } from "pg";
import { RepoPilotState } from "./state.ts";
import { intakeAgent } from "./nodes/intake.ts";
import { repoAnalysisAgent } from "./nodes/repo-analysis.ts";
import { issueDiscoveryAgent } from "./nodes/issue-discovery.ts";
import { rankingAgent } from "./nodes/ranking.ts";
import {
  humanCheckpointSelectIssue,
  humanCheckpointApproveDiff,
} from "./nodes/human-checkpoint.ts";
import { codeGenerationAgent } from "./nodes/code-generation.ts";
import { codeReviewAgent } from "./nodes/code-review.ts";
import { prAgent } from "./nodes/pr-agent.ts";

let _setupDone = false;

/**
 * Build and compile the LangGraph execution graph.
 * Returns the compiled app and the checkpointer.
 */
export async function buildGraph() {
  // ── Build the graph ──
  const graph = new StateGraph(RepoPilotState)
    // Add all nodes
    .addNode("intake", intakeAgent)
    .addNode("repo_analysis", repoAnalysisAgent)
    .addNode("issue_discovery", issueDiscoveryAgent)
    .addNode("ranking", rankingAgent)
    .addNode("human_checkpoint_select", humanCheckpointSelectIssue)
    .addNode("code_generation", codeGenerationAgent)
    .addNode("code_review", codeReviewAgent)
    .addNode("human_checkpoint_approve", humanCheckpointApproveDiff)
    .addNode("pr_agent", prAgent)

    // ── Edges ──
    // START → Intake
    .addEdge(START, "intake")

    // Intake → Repo Analysis (or END on error)
    .addConditionalEdges("intake", (state) => {
      if (state.status === "error") return END;
      return "repo_analysis";
    })

    // Repo Analysis → Issue Discovery (or END on error)
    .addConditionalEdges("repo_analysis", (state) => {
      if (state.status === "error") return END;
      return "issue_discovery";
    })

    // Issue Discovery → Ranking (or END on error)
    .addConditionalEdges("issue_discovery", (state) => {
      if (state.status === "error") return END;
      return "ranking";
    })

    // Ranking → Human Checkpoint (issue selection)
    .addConditionalEdges("ranking", (state) => {
      if (state.status === "error") return END;
      return "human_checkpoint_select";
    })

    // Human Checkpoint (select) → Code Generation (or END if cancelled)
    .addConditionalEdges("human_checkpoint_select", (state) => {
      if (state.status === "error") return END;
      if (state.userCancelled) return END;
      if (state.selectedIssueIndex == null) return END;
      return "code_generation";
    })

    // Code Generation → Code Review (or END on error)
    .addConditionalEdges("code_generation", (state) => {
      if (state.status === "error" || !state.generatedDiff) return END;
      return "code_review";
    })

    // Code Review → Code Generation (retry loop) or Human Checkpoint (approve)
    .addConditionalEdges("code_review", (state) => {
      if (state.status === "error") return END;
      // Retry if review failed and we haven't exceeded max retries
      if (state.reviewResult?.verdict === "request-changes" && state.reviewRetries < 3) {
        return "code_generation";
      }
      // Review passed → show diff to user for approval
      if (state.reviewResult?.verdict === "approve") {
        return "human_checkpoint_approve";
      }
      // Failed after max retries
      return END;
    })

    // Human Checkpoint (approve) → PR Agent or END
    .addConditionalEdges("human_checkpoint_approve", (state) => {
      if (state.diffApproved) return "pr_agent";
      return END; // user rejected
    })

    // PR Agent → END
    .addEdge("pr_agent", END);

  // ── Set up PostgresSaver for persistent checkpoints ──
  // Uses the DATABASE_URL env var if provided, otherwise constructs a
  // connection string from SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
  const databaseUrl = Deno.env.get("DATABASE_URL") ?? buildPoolerUrl();

  if (!databaseUrl) {
    throw new Error(
      "No database connection available for checkpoints. Set DATABASE_URL or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const checkpointer = new PostgresSaver(pool);

  // Initialize checkpointer tables (only once per process lifetime)
  if (!_setupDone) {
    try {
      await checkpointer.setup();
      _setupDone = true;
    } catch (err) {
      console.warn("Checkpointer setup warning (may already exist):", err);
      _setupDone = true; // don't retry on every cold start
    }
  }

  // ── Compile ──
  const app = graph.compile({ checkpointer });

  return { app, checkpointer, pool };
}

/**
 * Build a pooler connection string from SUPABASE_URL + SERVICE_ROLE_KEY.
 * This is a fallback when DATABASE_URL is not explicitly set.
 */
function buildPoolerUrl(): string | null {
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const supaKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !supaKey) return null;

  // Extract project ref from URL like https://<project>.supabase.co
  const match = supaUrl.match(/https:\/\/([^.]+)\.supabase\.co/);
  if (!match) return null;
  const projectRef = match[1];

  // Determine region from URL for the pooler host
  const region = supaUrl.includes("ap-") ? "ap-southeast-1" :
    supaUrl.includes("eu-") ? "eu-west-1" :
    supaUrl.includes("us-") ? "us-east-1" :
    "us-east-1";

  return `postgresql://postgres.${projectRef}:${supaKey}@aws-0-${region}.pooler.supabase.com:5432/postgres`;
}
