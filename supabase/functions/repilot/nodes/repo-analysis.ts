// ---------------------------------------------------------------------------
// Repo Analysis Agent node
// Responsibilities:
//   1. Fetch/read the repository via GitHub tree API
//   2. Build a structural map (modules, dependencies, conventions)
//   3. Use Gemini to analyze architecture, frameworks, quality signals
// ---------------------------------------------------------------------------
import { indexRepo } from "../lib/github.ts";
import { geminiJSON } from "../lib/gemini.ts";
import { startEvent, finishEvent, updateRun } from "../lib/supabase.ts";
import type { RepoPilotStateType } from "../state.ts";
import type { RepoIndex, RepoAnalysis } from "../types.ts";

const SYSTEM_BASE =
  "You are part of RepoPilot AI, a multi-agent system that analyzes public GitHub repositories. Always respond with valid JSON. Be specific, cite file paths, and ground every claim in the provided repository content.";

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

export async function repoAnalysisAgent(
  state: RepoPilotStateType,
): Promise<Partial<RepoPilotStateType>> {
  let evId: string | null = null;
  const startedAt = new Date().toISOString();

  try {
    evId = await startEvent(
      state.runId, "repo_analysis", "index",
      "Cloning and indexing repository via GitHub API…",
    );
    const { owner, repo: repoName } = parseRepoFromFullName(state.repoInfo?.fullName ?? "");

    // Index the repo
    const idxData = await indexRepo(
      owner,
      repoName,
      state.repoInfo?.defaultBranch ?? "main",
      state.githubToken,
    );

    // Build RepoIndex with metadata from Intake Agent
    const repoIndex: RepoIndex = {
      full_name: state.repoInfo?.fullName ?? `${owner}/${repoName}`,
      default_branch: state.repoInfo?.defaultBranch ?? "main",
      description: state.repoInfo?.description ?? "",
      language: state.repoInfo?.language ?? "",
      languages: [], // filled by indexRepo languages check
      tree: idxData.tree,
      fileContents: idxData.fileContents,
      readme: idxData.readme,
      packageJson: idxData.packageJson,
      fileCount: idxData.tree.filter((e) => e.type === "blob").length,
      totalBytes: idxData.totalBytes,
    };

    await finishEvent(evId, "done", {
      files: repoIndex.fileCount,
      sampled: Object.keys(repoIndex.fileContents).length,
    }, startedAt);

    // Now analyze with Gemini
    const analysisEvId = await startEvent(
      state.runId, "repo_analysis", "analyze",
      "Analyzing repository structure, dependencies, and conventions…",
    );
    const analysisStarted = new Date().toISOString();

    try {
      const analysisPrompt = `Analyze this repository and produce a structured overview.

${buildIndexDigest(repoIndex)}

Return JSON with this exact shape:
{
  "summary": "2-3 sentence plain-English overview of what this project is",
  "architecture": "description of the architecture and how the code is organized",
  "frameworks": ["..."],
  "dependencies": ["key dependencies"],
  "languages": ["..."],
  "conventions": {
    "naming": "...",
    "structure": "...",
    "testing": "...",
    "style": "..."
  },
  "entryPoints": ["main files"],
  "techStack": ["..."],
  "qualitySignals": {
    "hasTests": boolean,
    "testFramework": "string or null",
    "hasCi": boolean,
    "hasLintConfig": boolean,
    "readmeQuality": "none|minimal|good|excellent"
  }
}`;

      const analysis = await geminiJSON<RepoAnalysis>(analysisPrompt, SYSTEM_BASE);

      await finishEvent(analysisEvId, "done", {
        frameworks: analysis.frameworks?.length,
        languages: analysis.languages?.length,
      }, analysisStarted);

      await updateRun(state.runId, { summary: analysis });

      return {
        status: "analyzing",
        repoIndex,
        repoAnalysis: analysis,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await finishEvent(analysisEvId, "error", { error: msg }, analysisStarted);
      return {
        status: "error",
        error: msg,
        repoIndex,
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (evId) await finishEvent(evId, "error", { error: msg }, startedAt);
    await updateRun(state.runId, { status: "error", error: msg });
    return { status: "error", error: msg };
  }
}

function parseRepoFromFullName(fullName: string): { owner: string; repo: string } {
  const parts = fullName.split("/");
  return { owner: parts[0] ?? "", repo: parts[1] ?? "" };
}
