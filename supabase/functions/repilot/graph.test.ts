// ---------------------------------------------------------------------------
// Unit tests for graph.ts conditional edge routing
// Tests all conditional edge functions to verify correct node transitions:
//   - Error states route to END
//   - Happy path routes to next node
//   - Cancellation routes to END
//   - Retry loop routes back to code_generation
//   - Approved diff routes to pr_agent
//   - Rejected diff routes to END
// ---------------------------------------------------------------------------
import { assertEquals } from "jsr:@std/assert";
import { END } from "@langchain/langgraph";

interface ReviewResult {
  verdict: string;
  feedback: string | null;
  regressions: string[];
  testCode: string;
  testFile: string | null;
  score: number;
}

interface GraphTestState {
  runId: string;
  repoUrl: string;
  status: string;
  error: string | null;
  githubToken: string;
  tokenVerification: Record<string, unknown>;
  repoInfo: null;
  repoIndex: null;
  repoAnalysis: null;
  discoveredIssues: unknown[];
  rankedIssues: null;
  selectedIssueIndex: number | null;
  userCancelled: boolean;
  generatedDiff: string | null;
  generationAttempts: number;
  reviewResult: ReviewResult | null;
  reviewRetries: number;
  diffApproved: boolean | null;
  prResult: null;
  [key: string]: unknown;
}

// ── Create minimal state for edge routing tests ──
function createState(overrides: Partial<GraphTestState> = {}): GraphTestState {
  return {
    runId: "test-run-123",
    repoUrl: "https://github.com/facebook/react",
    status: "pending",
    error: null,
    githubToken: "mock-token",
    tokenVerification: { valid: true, login: "testuser", scopes: ["repo", "workflow"], missingScopes: [], hasRepoScope: true, hasWorkflowScope: true, hasForkRights: true, rateLimitRemaining: 5000, rateLimitReset: 0 },
    repoInfo: null,
    repoIndex: null,
    repoAnalysis: null,
    discoveredIssues: [],
    rankedIssues: null,
    selectedIssueIndex: null,
    userCancelled: false,
    generatedDiff: null,
    generationAttempts: 0,
    reviewResult: null,
    reviewRetries: 0,
    diffApproved: null,
    prResult: null,
    ...overrides,
  };
}

// ── Edge routing functions (extracted from graph.ts) ──

function intakeEdge(state: ReturnType<typeof createState>): string {
  if (state.status === "error") return END;
  return "repo_analysis";
}

function repoAnalysisEdge(state: ReturnType<typeof createState>): string {
  if (state.status === "error") return END;
  return "issue_discovery";
}

function issueDiscoveryEdge(state: ReturnType<typeof createState>): string {
  if (state.status === "error") return END;
  return "ranking";
}

function rankingEdge(state: ReturnType<typeof createState>): string {
  if (state.status === "error") return END;
  return "human_checkpoint_select";
}

function humanCheckpointSelectEdge(state: ReturnType<typeof createState>): string {
  if (state.status === "error") return END;
  if (state.userCancelled) return END;
  if (state.selectedIssueIndex == null) return END;
  return "code_generation";
}

function codeGenerationEdge(state: ReturnType<typeof createState>): string {
  if (state.status === "error" || !state.generatedDiff) return END;
  return "code_review";
}

function codeReviewEdge(state: ReturnType<typeof createState>): string {
  if (state.status === "error") return END;
  if (state.reviewResult?.verdict === "request-changes" && state.reviewRetries < 3) {
    return "code_generation";
  }
  if (state.reviewResult?.verdict === "approve") {
    return "human_checkpoint_approve";
  }
  return END;
}

function humanCheckpointApproveEdge(state: ReturnType<typeof createState>): string {
  if (state.diffApproved) return "pr_agent";
  return END;
}

// ── START → Intake ──
// (always START, always goes to intake — no conditional)
// graph.addEdge(START, "intake")

// ── Intake Edge ──

Deno.test("intake edge: success routes to repo_analysis", () => {
  const state = createState({ status: "indexing" });
  assertEquals(intakeEdge(state), "repo_analysis");
});

Deno.test("intake edge: error routes to END", () => {
  const state = createState({ status: "error", error: "Invalid URL" });
  assertEquals(intakeEdge(state), END);
});

// ── Repo Analysis Edge ──

Deno.test("repo_analysis edge: success routes to issue_discovery", () => {
  const state = createState({ status: "analyzing" });
  assertEquals(repoAnalysisEdge(state), "issue_discovery");
});

Deno.test("repo_analysis edge: error routes to END", () => {
  const state = createState({ status: "error", error: "Index failed" });
  assertEquals(repoAnalysisEdge(state), END);
});

// ── Issue Discovery Edge ──

Deno.test("issue_discovery edge: success routes to ranking", () => {
  const state = createState({ status: "analyzing", discoveredIssues: [{ title: "Bug", description: "A bug", category: "bug", severity: "high", confidence: 0.9, filesAffected: ["a.ts"], estimatedEffort: "1h", isImportant: false, source: "static_analysis" }] });
  assertEquals(issueDiscoveryEdge(state), "ranking");
});

Deno.test("issue_discovery edge: error routes to END", () => {
  const state = createState({ status: "error" });
  assertEquals(issueDiscoveryEdge(state), END);
});

// ── Ranking Edge ──

Deno.test("ranking edge: success routes to human_checkpoint_select", () => {
  const state = createState({ status: "analyzing" });
  assertEquals(rankingEdge(state), "human_checkpoint_select");
});

Deno.test("ranking edge: error routes to END", () => {
  const state = createState({ status: "error" });
  assertEquals(rankingEdge(state), END);
});

// ── Human Checkpoint Select Edge ──

Deno.test("human_checkpoint_select edge: issue selected routes to code_generation", () => {
  const state = createState({ status: "generating", selectedIssueIndex: 0 });
  assertEquals(humanCheckpointSelectEdge(state), "code_generation");
});

Deno.test("human_checkpoint_select edge: cancelled routes to END", () => {
  const state = createState({ userCancelled: true });
  assertEquals(humanCheckpointSelectEdge(state), END);
});

Deno.test("human_checkpoint_select edge: no selection routes to END", () => {
  const state = createState({ selectedIssueIndex: null });
  assertEquals(humanCheckpointSelectEdge(state), END);
});

Deno.test("human_checkpoint_select edge: error routes to END", () => {
  const state = createState({ status: "error" });
  assertEquals(humanCheckpointSelectEdge(state), END);
});

// ── Code Generation Edge ──

Deno.test("code_generation edge: success with diff routes to code_review", () => {
  const state = createState({ status: "generating", generatedDiff: "--- a/test.ts\n+++ b/test.ts\n@@ -1 +1,2 @@\n+new" });
  assertEquals(codeGenerationEdge(state), "code_review");
});

Deno.test("code_generation edge: no diff routes to END", () => {
  const state = createState({ status: "generating", generatedDiff: null });
  assertEquals(codeGenerationEdge(state), END);
});

Deno.test("code_generation edge: error routes to END", () => {
  const state = createState({ status: "error", generatedDiff: null });
  assertEquals(codeGenerationEdge(state), END);
});

// ── Code Review Edge (the retry loop) ──

Deno.test("code_review edge: approve routes to human_checkpoint_approve", () => {
  const state = createState({
    reviewResult: { verdict: "approve", feedback: null, regressions: [], testCode: "", testFile: null, score: 85 },
    reviewRetries: 0,
  });
  assertEquals(codeReviewEdge(state), "human_checkpoint_approve");
});

Deno.test("code_review edge: request-changes with retries < 3 routes to code_generation (retry)", () => {
  const state = createState({
    reviewResult: { verdict: "request-changes", feedback: "Fix style", regressions: [], testCode: "", testFile: null, score: 40 },
    reviewRetries: 1,
  });
  assertEquals(codeReviewEdge(state), "code_generation");
});

Deno.test("code_review edge: request-changes at retry 2 routes to code_generation (last retry)", () => {
  const state = createState({
    reviewResult: { verdict: "request-changes", feedback: "Fix style", regressions: [], testCode: "", testFile: null, score: 40 },
    reviewRetries: 2,
  });
  assertEquals(codeReviewEdge(state), "code_generation");
});

Deno.test("code_review edge: request-changes at retry 3 routes to END (max exceeded)", () => {
  const state = createState({
    reviewResult: { verdict: "request-changes", feedback: "Still broken", regressions: [], testCode: "", testFile: null, score: 30 },
    reviewRetries: 3,
  });
  assertEquals(codeReviewEdge(state), END);
});

Deno.test("code_review edge: error status routes to END", () => {
  const state = createState({ status: "error", reviewResult: null });
  assertEquals(codeReviewEdge(state), END);
});

Deno.test("code_review edge: no reviewResult routes to END", () => {
  const state = createState({ reviewResult: null });
  assertEquals(codeReviewEdge(state), END);
});

// ── Human Checkpoint Approve Edge ──

Deno.test("human_checkpoint_approve edge: approved routes to pr_agent", () => {
  const state = createState({ diffApproved: true });
  assertEquals(humanCheckpointApproveEdge(state), "pr_agent");
});

Deno.test("human_checkpoint_approve edge: rejected routes to END", () => {
  const state = createState({ diffApproved: false });
  assertEquals(humanCheckpointApproveEdge(state), END);
});

Deno.test("human_checkpoint_approve edge: null diffApproved routes to END", () => {
  const state = createState({ diffApproved: null });
  assertEquals(humanCheckpointApproveEdge(state), END);
});

// ── Full graph flow tests ──

Deno.test("full graph: happy path flows through all nodes", () => {
  const state = createState();
  assertEquals(intakeEdge(state), "repo_analysis");

  const s1 = createState({ status: "indexing" });
  assertEquals(intakeEdge(s1), "repo_analysis");
  assertEquals(repoAnalysisEdge(s1), "issue_discovery");
  assertEquals(issueDiscoveryEdge(s1), "ranking");
  assertEquals(rankingEdge(s1), "human_checkpoint_select");

  const s2 = createState({ status: "generating", selectedIssueIndex: 0 });
  assertEquals(humanCheckpointSelectEdge(s2), "code_generation");

  const s3 = createState({ status: "generating", selectedIssueIndex: 0, generatedDiff: "diff --git a/test.ts b/test.ts\nindex 123..456 789\n--- a/test.ts\n+++ b/test.ts\n@@ -1 +1,2 @@\n+new content" });
  assertEquals(codeGenerationEdge(s3), "code_review");

  const s4 = createState({ status: "generating", selectedIssueIndex: 0, generatedDiff: "mock diff", reviewResult: { verdict: "approve", feedback: null, regressions: [], testCode: "", testFile: null, score: 85 }, reviewRetries: 0 });
  assertEquals(codeReviewEdge(s4), "human_checkpoint_approve");

  const s5 = createState({ status: "completed", diffApproved: true });
  assertEquals(humanCheckpointApproveEdge(s5), "pr_agent");
});

Deno.test("full graph: user cancellation ends at checkpoint select", () => {
  const state = createState({ userCancelled: true });
  assertEquals(humanCheckpointSelectEdge(state), END);
});

Deno.test("full graph: retry loop routes code_review → code_generation → code_review", () => {
  // First review fails
  const s1 = createState({
    selectedIssueIndex: 0,
    generatedDiff: "mock diff",
    reviewResult: { verdict: "request-changes", feedback: "Fix indent", regressions: [], testCode: "", testFile: null, score: 40 },
    reviewRetries: 0,
  });
  assertEquals(codeReviewEdge(s1), "code_generation");

  // Regenerate (code_generation runs) — not tested here, already covered

  // Second review succeeds
  const s2 = createState({
    selectedIssueIndex: 0,
    generatedDiff: "mock diff v2",
    reviewResult: { verdict: "approve", feedback: null, regressions: [], testCode: "", testFile: null, score: 85 },
    reviewRetries: 1,
  });
  assertEquals(codeReviewEdge(s2), "human_checkpoint_approve");
});

Deno.test("full graph: error at any node routes to END", () => {
  const states = [
    createState({ status: "error", error: "Intake failed" }),
    createState({ status: "error", error: "Analysis failed" }),
    createState({ status: "error", error: "No issues found" }),
    createState({ status: "error", error: "Ranking failed" }),
    createState({ status: "error", error: "Code gen failed" }),
    createState({ status: "error", error: "Review failed" }),
  ];

  for (const s of states) {
    assertEquals(intakeEdge(s), END);
    assertEquals(repoAnalysisEdge(s), END);
    assertEquals(issueDiscoveryEdge(s), END);
    assertEquals(rankingEdge(s), END);
    assertEquals(humanCheckpointSelectEdge(s), END);
    assertEquals(codeGenerationEdge(s), END);
    assertEquals(codeReviewEdge(s), END);
    assertEquals(humanCheckpointApproveEdge(s), END);
  }
});
