// ---------------------------------------------------------------------------
// PR Agent node
// Responsibilities:
//   1. Check if the user already has a fork (avoid duplicate fork creation)
//   2. If no fork exists, create one and wait for readiness
//   3. Create a new branch from the default branch
//   4. Commit the approved diff to the branch
//   5. Open a pull request with title/description referencing the issue
//
// ONLY runs after the user has explicitly confirmed the diff (checkpoint 2).
// ---------------------------------------------------------------------------
import { startEvent, finishEvent, updateRun, getRun, insertPrRequest, insertProposal } from "../lib/supabase.ts";
import { checkExistingFork } from "../lib/github.ts";
import type { RepoPilotStateType } from "../state.ts";
import type { PrResult } from "../types.ts";
import { parseDiff, extractFinalContent } from "../lib/diff.ts";

export async function prAgent(
  state: RepoPilotStateType,
): Promise<Partial<RepoPilotStateType>> {
  let evId: string | null = null;
  const startedAt = new Date().toISOString();

  try {
    evId = await startEvent(
      state.runId, "pr_agent", "pr",
      "Creating pull request on GitHub…",
    );
    const token = state.githubToken;
    if (!token) {
      throw new Error("No GITHUB_TOKEN configured. Set GITHUB_TOKEN in edge function secrets.");
    }

    const login = state.tokenVerification?.login;
    if (!login) {
      throw new Error("GitHub login not available. Token may be invalid.");
    }

    const run = await getRun(state.runId);
    if (!run) throw new Error("Run not found");

    const [owner, repo] = (run.repo_full_name ?? "").split("/");
    if (!owner || !repo) throw new Error("Invalid repo_full_name");

    const selectedIssue = state.rankedIssues?.[state.selectedIssueIndex ?? -1];
    const defaultBranch = state.repoInfo?.defaultBranch ?? "main";

    // ── GitHub API helper (authenticated) ──
    const gh = (path: string, opts: RequestInit = {}) =>
      fetch(`https://api.github.com${path}`, {
        ...opts,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "RepoPilot-AI",
          ...(opts.body ? { "Content-Type": "application/json" } : {}),
        },
      });

    // 1. Determine fork target
    let forkOwner = owner;
    let forkRepo = repo;

    if (owner !== login) {
      // Check for existing fork first
      const existingFork = await checkExistingFork(owner, repo, login, token);
      if (existingFork) {
        const [fo, fr] = existingFork.split("/");
        forkOwner = fo;
        forkRepo = fr;
      } else {
        // Create a new fork
        const forkRes = await gh(`/repos/${owner}/${repo}/forks`, { method: "POST" });
        if (!forkRes.ok) {
          const txt = await forkRes.text();
          throw new Error(`Fork creation failed: ${txt.slice(0, 200)}`);
        }
        const fork = await forkRes.json();
        forkOwner = login;
        forkRepo = fork.name ?? repo;

        // Wait for fork to be ready
        for (let i = 0; i < 15; i++) {
          const r = await gh(`/repos/${forkOwner}/${forkRepo}`);
          if (r.ok) {
            const j = await r.json();
            if (j.size !== undefined) break;
          }
          await new Promise((res) => setTimeout(res, 2000));
        }
      }
    }

    // 2. Get default branch SHA
    const branchRes = await gh(`/repos/${forkOwner}/${forkRepo}/branches/${defaultBranch}`);
    if (!branchRes.ok) throw new Error(`Could not resolve branch ${defaultBranch}`);
    const branch = await branchRes.json();
    const baseSha = branch?.commit?.sha;
    if (!baseSha) throw new Error("Could not resolve base branch SHA");

    // 3. Create a new branch
    const newBranch = `repopilot/${state.runId.slice(0, 8)}`;
    const refRes = await gh(`/repos/${forkOwner}/${forkRepo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: baseSha }),
    });
    if (!refRes.ok) {
      const txt = await refRes.text();
      throw new Error(`Branch creation failed: ${txt.slice(0, 200)}`);
    }

    // 4. Extract final file contents from the diff and commit each file
    const diff = state.generatedDiff ?? "";
    const parsedFiles = parseDiff(diff);
    const approvedFiles: { path: string; content: string }[] = [];

    for (const pf of parsedFiles) {
      const content = extractFinalContent(diff, pf.path);
      if (!content) continue;

      // Base64 encode for the GitHub Contents API
      const encoded = btoa(unescape(encodeURIComponent(content)));

      const putRes = await gh(`/repos/${forkOwner}/${forkRepo}/contents/${pf.path}`, {
        method: "PUT",
        body: JSON.stringify({
          message: `fix: ${pf.path} — ${selectedIssue?.issue.title ?? "RepoPilot AI contribution"}`,
          content: encoded,
          branch: newBranch,
        }),
      });
      if (!putRes.ok) {
        const txt = await putRes.text();
        console.error(`Failed to commit ${pf.path}: ${txt.slice(0, 200)}`);
        continue;
      }
      approvedFiles.push({ path: pf.path, content });
    }

    if (approvedFiles.length === 0) {
      throw new Error("No files could be committed from the generated diff");
    }

    // 5. Open a pull request
    const issueRef = selectedIssue?.issue.githubIssueNumber
      ? ` (refers to #${selectedIssue.issue.githubIssueNumber})`
      : "";
    const prBody = [
      `## 🤖 RepoPilot AI Contribution${issueRef}`,
      "",
      `**Issue**: ${selectedIssue?.issue.title ?? "Improvement"}`,
      `**Description**: ${selectedIssue?.issue.description ?? ""}`,
      "",
      "---",
      "",
      "Changes proposed by RepoPilot AI after multi-agent analysis and human review.",
      "",
      "### What was done",
      selectedIssue?.issue.description ?? "",
      "",
      "### Files changed",
      ...approvedFiles.map((f) => `- \`${f.path}\``),
      "",
      "---",
      "> ⚡ This PR was generated by an AI agent team and approved by a human reviewer.",
    ].join("\n");

    const prRes = await gh(`/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: `RepoPilot AI: ${selectedIssue?.issue.title ?? "code improvement"}`,
        head: `${forkOwner}:${newBranch}`,
        base: defaultBranch,
        body: prBody,
      }),
    });

    const pr = await prRes.json();
    const prUrl = pr.html_url ?? null;
    const prNumber = pr.number ?? null;

    // 6. Persist results
    await insertPrRequest(
      state.runId,
      login,
      `https://github.com/${forkOwner}/${forkRepo}`,
      newBranch,
      prUrl,
      prNumber,
      prRes.ok ? "created" : "error",
      prRes.ok ? null : (pr.message ?? "PR creation failed"),
      approvedFiles,
    );

    // Also persist the proposal for the frontend to reference
    if (selectedIssue?.issue.title) {
      // Get the issue ID from the database
      // (This is a simplified approach — the issue was already inserted by ranking agent)
    }

    const prResult: PrResult = {
      prUrl,
      prNumber,
      branchName: newBranch,
      forkUrl: `https://github.com/${forkOwner}/${forkRepo}`,
      error: prRes.ok ? null : (pr.message ?? "PR creation failed"),
    };

    await finishEvent(evId, prRes.ok ? "done" : "error", {
      pr_url: prUrl,
      pr_number: prNumber,
    }, startedAt);

    if (!prRes.ok) {
      throw new Error(pr.message ?? "PR creation failed");
    }

    await updateRun(state.runId, { status: "completed" });

    return {
      status: "completed",
      prResult,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (evId) await finishEvent(evId, "error", { error: msg }, startedAt);
    const prResult: PrResult = {
      prUrl: null,
      prNumber: null,
      branchName: null,
      forkUrl: null,
      error: msg,
    };
    await updateRun(state.runId, { status: "error", error: msg });
    return {
      status: "error",
      error: msg,
      prResult,
    };
  }
}
