// ---------------------------------------------------------------------------
// Code Review Agent node
// Honest description: AI-powered code review — checks code correctness, style,
// and generates test cases. Does NOT execute the target repo's test suite
// (which may be in a different language/stack).
//
// If review fails, returns feedback for a retry loop (max 3 attempts).
// ---------------------------------------------------------------------------
import { geminiJSON } from "../lib/gemini.ts";
import { startEvent, finishEvent } from "../lib/supabase.ts";
import type { RepoPilotStateType } from "../state.ts";
import type { CodeReviewResult } from "../types.ts";

const MAX_RETRIES = 3;

const SYSTEM_BASE =
  "You are the Code Review Agent in RepoPilot AI. Review the proposed code change for correctness, style, and regressions. Generate appropriate test code. NOTE: You do not execute tests — you perform an AI-based review only. Always respond with valid JSON.";

export async function codeReviewAgent(
  state: RepoPilotStateType,
): Promise<Partial<RepoPilotStateType>> {
  const selectedIssue = state.rankedIssues?.[state.selectedIssueIndex ?? -1];
  if (!selectedIssue) {
    return { status: "error", error: "No issue selected for code review" };
  }

  let evId: string | null = null;
  const startedAt = new Date().toISOString();

  try {
    evId = await startEvent(
      state.runId, "code_review", "review",
      `Reviewing generated fix for: ${selectedIssue.issue.title}`,
    );
    const repoAnalysis = state.repoAnalysis!;
    // Use nullish coalescing because MemorySaver may not apply defaults
    const retries = state.reviewRetries ?? 0;

    const prompt = `You are the Code Review Agent. Review the proposed code change and generate appropriate tests.

Repository conventions (testing):
${JSON.stringify(repoAnalysis.conventions?.testing ?? "unknown").slice(0, 600)}

Issue:
Title: ${selectedIssue.issue.title}
Description: ${selectedIssue.issue.description}
Severity: ${selectedIssue.issue.severity}
Category: ${selectedIssue.issue.category}

Proposed diff:
${state.generatedDiff ?? "(no diff provided)"}

Review the change on these dimensions:
1. **Correctness**: Does the change actually fix the described issue?
2. **Style**: Does it follow the repo's conventions?
3. **Regressions**: Could this break anything?
4. **Edge cases**: Are edge cases handled?

Then generate test code that validates the change.

IMPORTANT: This is a code review performed by AI. No actual test execution occurs.

Return JSON: {
  "verdict": "approve" or "request-changes",
  "feedback": "specific feedback if changes requested, or null if approved",
  "regressions": ["potential regression risks, or empty array if none"],
  "testCode": "the full test file content as a single string, ready to save, or '' if not applicable",
  "testFile": "suggested path for the test file, or null",
  "score": number between 0-100
}`;

    const result = await geminiJSON<CodeReviewResult>(prompt, SYSTEM_BASE);

    const passed = result.verdict === "approve";
    const newRetries = retries + (passed ? 0 : 1);

    await finishEvent(evId, "done", {
      verdict: result.verdict,
      score: result.score,
      retry: newRetries,
      regressions: result.regressions?.length ?? 0,
    }, startedAt);

    if (passed || newRetries >= MAX_RETRIES) {
      return {
        reviewResult: result,
        reviewRetries: newRetries,
        status: passed ? "awaiting_approval" : "error",
        error: passed ? null : `Code review failed after ${newRetries} attempts. Last feedback: ${result.feedback}`,
      };
    }

    // Retry — loop back to code generation with feedback
    return {
      reviewResult: result,
      reviewRetries: newRetries,
      error: result.feedback,
      status: "generating", // signal to retry code gen
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (evId) await finishEvent(evId, "error", { error: msg }, startedAt);
    return { status: "error", error: msg };
  }
}
