// ---------------------------------------------------------------------------
// Code Generation Agent node
// Responsibilities:
//   1. Read the selected issue's details
//   2. Study the relevant files from the repo index
//   3. Generate a unified diff that fixes the issue, following repo conventions
// ---------------------------------------------------------------------------
import { geminiJSON } from "../lib/gemini.ts";
import { startEvent, finishEvent } from "../lib/supabase.ts";
import type { RepoPilotStateType } from "../state.ts";

const SYSTEM_BASE =
  "You are the Code Engineer in RepoPilot AI. Generate production-quality code that matches the repository's existing style and conventions exactly. Always respond with valid JSON.";

export async function codeGenerationAgent(
  state: RepoPilotStateType,
): Promise<Partial<RepoPilotStateType>> {
  const selectedIssue = state.rankedIssues?.[state.selectedIssueIndex ?? -1];
  if (!selectedIssue) {
    return {
      status: "error",
      error: "No issue selected for code generation",
    };
  }

  let evId: string | null = null;
  const startedAt = new Date().toISOString();

  try {
    evId = await startEvent(
      state.runId, "code_generation", "implement",
      `Generating fix for: ${selectedIssue.issue.title}`,
    );
    const repoAnalysis = state.repoAnalysis!;
    const repoIndex = state.repoIndex!;

    // Gather relevant files
    const relevantFiles = Object.entries(repoIndex.fileContents)
      .filter(([p]) =>
        selectedIssue.issue.filesAffected.some((f: string) => p.includes(f) || f.includes(p)),
      )
      .map(([p, c]) => `--- FILE: ${p} ---\n${c}`)
      .join("\n\n");

    const prompt = `You are the Code Engineer. Implement the fix for the issue below as a unified diff. Follow the repository's existing style and conventions exactly.

Repository conventions:
${JSON.stringify(repoAnalysis.conventions ?? {}).slice(0, 800)}

Issue:
Title: ${selectedIssue.issue.title}
Description: ${selectedIssue.issue.description}
Severity: ${selectedIssue.issue.severity}
Category: ${selectedIssue.issue.category}
Affected files: ${selectedIssue.issue.filesAffected.join(", ")}
Estimated effort: ${selectedIssue.issue.estimatedEffort}

Current relevant file contents:
${relevantFiles || "(files not fetched — infer from tree)"}

Produce a unified diff in standard git format. Each hunk header must use \`--- a/path\` and \`+++ b/path\` with @@ line markers. Only modify files necessary for this fix. Do not invent file contents — base changes on the provided files.

IMPORTANT: The diff string will be embedded in JSON. You MUST properly escape all special characters inside the JSON string value:
- Newlines must be \\n
- Tabs must be \\t
- Backslashes must be \\\\
- Double quotes inside the diff must be \\"

Return JSON: { "diff": "the full unified diff as a single escaped string", "files": ["paths touched"], "notes": "brief explanation of what changed and why" }`;

    const result = await geminiJSON<{ diff: string; files: string[]; notes: string }>(
      prompt,
      SYSTEM_BASE,
    );

    // Use nullish coalescing because MemorySaver may not apply defaults
    const attempts = (state.generationAttempts ?? 0) + 1;

    await finishEvent(evId, "done", {
      files: result.files ?? [],
      attempt: attempts,
    }, startedAt);

    return {
      generatedDiff: result.diff,
      generationAttempts: attempts,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (evId) await finishEvent(evId, "error", { error: msg }, startedAt);
    return {
      generatedDiff: null,
      generationAttempts: (state.generationAttempts ?? 0) + 1,
      error: msg,
      status: "error",
    };
  }
}
