// ---------------------------------------------------------------------------
// Intake Agent node
// Responsibilities:
//   1. Validate the GitHub URL format
//   2. Verify the GITHUB_TOKEN (if provided) has repo + workflow scopes
//   3. Fetch repo metadata (public, exists, language, etc.)
//   4. Fail early with clear messages if anything is wrong
// ---------------------------------------------------------------------------
import type { RepoPilotStateType } from "../state.ts";
import {
  parseRepoUrl,
  verifyToken,
  getRepoMeta,
  hasContributingFile,
} from "../lib/github.ts";
import { startEvent, finishEvent, updateRun } from "../lib/supabase.ts";
import type { RepoMetadata, TokenVerification } from "../types.ts";

const SYSTEM_BASE =
  "You are part of RepoPilot AI, a multi-agent system that analyzes public GitHub repositories and proposes high-quality contributions.";

export async function intakeAgent(state: RepoPilotStateType): Promise<Partial<RepoPilotStateType>> {
  let evId: string | null = null;
  const startedAt = new Date().toISOString();

  try {
    evId = await startEvent(state.runId, "intake", "validate", "Validating repository URL and checking GitHub credentials…");

    // 1. Parse URL
    const { owner, repo } = parseRepoUrl(state.repoUrl);

    // 2. Read PAT from env (optional but strongly recommended)
    const githubToken = Deno.env.get("GITHUB_TOKEN") ?? null;

    // 3. Verify token if available
    let tokenVerification: TokenVerification | null = null;
    if (githubToken) {
      const tv = await verifyToken(githubToken);
      tokenVerification = {
        valid: tv.valid,
        login: tv.login,
        scopes: tv.scopes,
        missingScopes: tv.missingScopes,
        hasRepoScope: tv.hasRepoScope,
        hasWorkflowScope: tv.hasWorkflowScope,
        hasForkRights: null, // checked later
        rateLimitRemaining: tv.rateLimitRemaining,
        rateLimitReset: tv.rateLimitReset,
      };

      if (!tv.valid) {
        const msg = `GitHub token is missing required scopes. Missing: ${tv.missingScopes.join(", ")}. Generate a PAT at https://github.com/settings/tokens with repo and workflow scopes.`;
        await finishEvent(evId, "error", { error: msg }, startedAt);
        await updateRun(state.runId, { status: "error", error: msg });
        return {
          status: "error",
          error: msg,
          githubToken,
          tokenVerification,
        };
      }
    }

    // 4. Fetch repo metadata
    const meta = await getRepoMeta(owner, repo, githubToken);

    if (!meta.isPublic) {
      const msg = `Repository ${meta.fullName} is private. RepoPilot AI only works with public repositories.`;
      await finishEvent(evId, "error", { error: msg }, startedAt);
      await updateRun(state.runId, { status: "error", error: msg });
      return {
        status: "error",
        error: msg,
        githubToken,
        tokenVerification,
      };
    }

    // 5. Check for CONTRIBUTING.md
    const hasContributing = await hasContributingFile(owner, repo, meta.defaultBranch);

    // 6. Build repo metadata
    const repoInfo: RepoMetadata = {
      owner,
      repo,
      fullName: meta.fullName,
      defaultBranch: meta.defaultBranch,
      description: meta.description,
      isPublic: meta.isPublic,
      language: meta.language,
      topics: meta.topics,
      stars: meta.stars,
      openIssuesCount: meta.openIssuesCount,
      hasContributing,
      hasCodeOfConduct: false, // not checked yet
      license: meta.license,
    };

    // 7. Warn if no token is configured
    if (!githubToken) {
      const rateMsg = "No GITHUB_TOKEN configured. Unauthenticated requests have a low rate limit (60/hr). PR creation will require a token later.";
      console.warn(rateMsg);
      // Don't fail — let the user proceed for analysis-only
    }

    await finishEvent(evId, "done", {
      repo: meta.fullName,
      branch: meta.defaultBranch,
      hasToken: !!githubToken,
      tokenUser: tokenVerification?.login ?? null,
    }, startedAt);

    await updateRun(state.runId, {
      repo_full_name: meta.fullName,
      default_branch: meta.defaultBranch,
      status: "indexing",
    });

    return {
      status: "indexing",
      repoInfo,
      githubToken,
      tokenVerification,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (evId) await finishEvent(evId, "error", { error: msg }, startedAt);
    await updateRun(state.runId, { status: "error", error: msg });
    return {
      status: "error",
      error: msg,
    };
  }
}
