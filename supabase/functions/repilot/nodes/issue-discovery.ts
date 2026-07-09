// ---------------------------------------------------------------------------
// Issue Discovery Agent node
// Responsibilities:
//   1. Fetch open GitHub issues labeled "good first issue" / "help wanted"
//   2. Run static analysis via Gemini to find bugs, TODOs, code smells
//   3. Merge both sources into a unified issue list
// ---------------------------------------------------------------------------
import { fetchLabeledIssues } from "../lib/github.ts";
import { geminiJSON } from "../lib/gemini.ts";
import { startEvent, finishEvent, updateRun } from "../lib/supabase.ts";
import type { RepoPilotStateType } from "../state.ts";
import type { DiscoveredIssue, RepoIndex, RepoAnalysis } from "../types.ts";

const SYSTEM_BASE =
  "You are the Issue Hunter agent in RepoPilot AI. Scan the repository and identify concrete, actionable issues a contributor could fix. Always respond with valid JSON.";

function buildIndexDigest(idx: RepoIndex): string {
  const fileList = idx.tree
    .filter((e) => e.type === "blob")
    .map((e) => e.path)
    .slice(0, 200)
    .join("\n");
  const fileBlocks = Object.entries(idx.fileContents)
    .map(([path, content]) => `--- FILE: ${path} ---\n${content}`)
    .join("\n\n");
  return [
    `Repository: ${idx.full_name} (default branch: ${idx.default_branch})`,
    `Description: ${idx.description}`,
    `Primary language: ${idx.language} | Languages: ${idx.languages.join(", ")}`,
    `Total files in tree: ${idx.fileCount}`,
    "",
    "## File tree (paths)",
    fileList,
    "",
    idx.readme ? `## README.md\n${idx.readme}\n` : "",
    idx.packageJson ? `## package.json\n${idx.packageJson}\n` : "",
    "## Sample source files",
    fileBlocks,
  ].join("\n");
}

export async function issueDiscoveryAgent(
  state: RepoPilotStateType,
): Promise<Partial<RepoPilotStateType>> {
  let evId: string | null = null;
  const startedAt = new Date().toISOString();

  try {
    evId = await startEvent(
      state.runId, "issue_discovery", "scan",
      "Hunting for bugs, TODOs, code smells, security risks, and contribution opportunities…",
    );
    const repoInfo = state.repoInfo!;
    const repoIndex = state.repoIndex!;
    const repoAnalysis = state.repoAnalysis!;

    // 1. Fetch labeled GitHub issues (if any)
    const labeledIssues = await fetchLabeledIssues(
      repoInfo.owner,
      repoInfo.repo,
      state.githubToken,
    );

    const githubIssues: DiscoveredIssue[] = labeledIssues.map((gi) => ({
      title: gi.title,
      description: gi.body.slice(0, 1500),
      category: "beginner",
      severity: "medium",
      confidence: 0.7,
      filesAffected: [],
      estimatedEffort: "varies",
      isImportant: false,
      source: "github_issue",
      githubIssueUrl: gi.url,
      githubIssueNumber: gi.number,
    }));

    // 2. Static analysis via Gemini
    const staticEvId = await startEvent(
      state.runId, "issue_discovery", "static-analysis",
      "Running static analysis on source files…",
    );
    const staticStarted = new Date().toISOString();

    const prompt = `You are the Issue Hunter. Scan the repository below and identify concrete, actionable issues a contributor could fix. Look for: bugs, TODOs/FIXMEs, code smells, duplicated logic, missing documentation, missing tests, performance issues, security risks, and beginner-friendly opportunities. Prioritize issues that are real and fixable.

Repository overview:
${JSON.stringify(repoAnalysis).slice(0, 3000)}

${buildIndexDigest(repoIndex)}

Return JSON: { "issues": [ { "title": "...", "description": "detailed description of the issue and why it matters", "category": "bug|todo|smell|duplication|docs|tests|performance|security|beginner", "severity": "critical|high|medium|low", "confidence": 0-1 number, "filesAffected": ["paths"], "estimatedEffort": "e.g. '2-4 hours'", "isImportant": boolean (true if it warrants two independent implementations) } ] }
Return between 4 and 8 issues, ordered by severity then confidence. Ground each issue in specific files from the repository.`;

    const result = await geminiJSON<{ issues: any[] }>(prompt, SYSTEM_BASE);
    const staticIssues: DiscoveredIssue[] = (result.issues ?? []).map((i: any) => ({
      title: i.title,
      description: i.description,
      category: i.category ?? "smell",
      severity: i.severity ?? "medium",
      confidence: i.confidence ?? 0.5,
      filesAffected: i.filesAffected ?? i.files_affected ?? [],
      estimatedEffort: i.estimatedEffort ?? i.estimated_effort ?? "unknown",
      isImportant: !!i.isImportant,
      source: "static_analysis",
    }));

    await finishEvent(staticEvId, "done", {
      staticIssueCount: staticIssues.length,
    }, staticStarted);

    // 3. Merge both sources — prefer static analysis, deduplicate by title
    const allTitles = new Set<string>();
    const mergedIssues: DiscoveredIssue[] = [];

    for (const gi of githubIssues) {
      const key = gi.title.toLowerCase().slice(0, 60);
      if (!allTitles.has(key)) {
        allTitles.add(key);
        mergedIssues.push(gi);
      }
    }

    for (const si of staticIssues) {
      const key = si.title.toLowerCase().slice(0, 60);
      if (!allTitles.has(key)) {
        allTitles.add(key);
        mergedIssues.push(si);
      }
    }

    await finishEvent(evId, "done", {
      totalIssues: mergedIssues.length,
      fromGitHub: githubIssues.length,
      fromStaticAnalysis: staticIssues.length,
    }, startedAt);

    return {
      discoveredIssues: mergedIssues,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (evId) await finishEvent(evId, "error", { error: msg }, startedAt);
    await updateRun(state.runId, { status: "error", error: msg });
    return { status: "error", error: msg };
  }
}
