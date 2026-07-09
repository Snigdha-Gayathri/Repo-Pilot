// ---------------------------------------------------------------------------
// GitHub API helper — with exponential backoff, rate-limit detection,
// PAT scope verification, and existing-fork detection.
// ---------------------------------------------------------------------------

const GITHUB_BASE = "https://api.github.com";
const USER_AGENT = "RepoPilot-AI";

interface RateLimitInfo {
  remaining: number;
  reset: number;
  limit: number;
}

/**
 * Call the GitHub REST API with retry + rate-limit backoff.
 * Uses the provided token if available, otherwise unauthenticated.
 */
export async function ghApi<T = any>(
  path: string,
  opts: RequestInit = {},
  token?: string | null,
  retries = 3,
): Promise<{ data: T; rateLimit: RateLimitInfo }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (opts.body && typeof opts.body === "string") {
    headers["Content-Type"] = "application/json";
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${GITHUB_BASE}${path}`, {
      ...opts,
      headers: { ...headers, ...((opts.headers as Record<string, string>) || {}) },
    });

    const rateLimit: RateLimitInfo = {
      remaining: parseInt(res.headers.get("X-RateLimit-Remaining") ?? "-1", 10),
      reset: parseInt(res.headers.get("X-RateLimit-Reset") ?? "0", 10),
      limit: parseInt(res.headers.get("X-RateLimit-Limit") ?? "-1", 10),
    };

    if (res.ok) {
      const data = await res.json() as T;
      return { data, rateLimit };
    }

    // Rate limited or abuse detection
    if (res.status === 403 || res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") ?? "0", 10);

      if (rateLimit.remaining === 0 && attempt < retries) {
        const waitMs = retryAfter > 0
          ? Math.min(retryAfter * 1000, 30000)
          : Math.min(1000 * Math.pow(2, attempt), 30000);
        await sleep(waitMs);
        continue;
      }

      // If it's a 403 but not rate-limit related (e.g. permission denied), don't retry
      if (res.status === 403 && rateLimit.remaining > 0) {
        const txt = await res.text();
        throw new Error(`GitHub API 403 for ${path}: ${txt.slice(0, 200)}`);
      }
    }

    // Server errors — retry with backoff
    if (res.status >= 500 && attempt < retries) {
      const waitMs = Math.min(1000 * Math.pow(2, attempt), 15000);
      await sleep(waitMs);
      continue;
    }

    const txt = await res.text();
    throw new Error(`GitHub API ${res.status} for ${path}: ${txt.slice(0, 200)}`);
  }

  throw lastError ?? new Error(`GitHub API exceeded retries for ${path}`);
}

/**
 * Verify a GitHub PAT: check token validity, scopes, and rate-limit status.
 */
export async function verifyToken(
  token: string,
): Promise<{
  valid: boolean;
  login: string | null;
  scopes: string[];
  missingScopes: string[];
  hasRepoScope: boolean;
  hasWorkflowScope: boolean;
  rateLimitRemaining: number;
  rateLimitReset: number;
}> {
  try {
    // Check token + get user info
    const { data: user, rateLimit } = await ghApi<any>("/user", {}, token, 1);
    if (!user.login) {
      return {
        valid: false,
        login: null,
        scopes: [],
        missingScopes: ["repo", "workflow"],
        hasRepoScope: false,
        hasWorkflowScope: false,
        rateLimitRemaining: rateLimit.remaining,
        rateLimitReset: rateLimit.reset,
      };
    }

    // Check scopes from headers via a lightweight endpoint
    const scopeRes = await fetch(`${GITHUB_BASE}/rate_limit`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT,
      },
    });
    const scopesHeader = scopeRes.headers.get("X-OAuth-Scopes") ?? "";
    const scopes = scopesHeader.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

    const hasRepoScope = scopes.includes("repo") || scopes.includes("public_repo");
    const hasWorkflowScope = scopes.includes("workflow");
    const missingScopes: string[] = [];
    if (!hasRepoScope) missingScopes.push("repo (or public_repo)");
    if (!hasWorkflowScope) missingScopes.push("workflow");

    return {
      valid: hasRepoScope,
      login: user.login,
      scopes,
      missingScopes,
      hasRepoScope,
      hasWorkflowScope,
      rateLimitRemaining: rateLimit.remaining,
      rateLimitReset: rateLimit.reset,
    };
  } catch (err) {
    return {
      valid: false,
      login: null,
      scopes: [],
      missingScopes: ["repo", "workflow"],
      hasRepoScope: false,
      hasWorkflowScope: false,
      rateLimitRemaining: 0,
      rateLimitReset: 0,
    };
  }
}

/**
 * Check if the user already has a fork of the target repo.
 * Returns the fork's full_name if found, null otherwise.
 */
export async function checkExistingFork(
  owner: string,
  repo: string,
  login: string,
  token: string,
): Promise<string | null> {
  try {
    const { data: forks } = await ghApi<any[]>(
      `/repos/${owner}/${repo}/forks?per_page=50`,
      {},
      token,
      2,
    );
    const existing = forks.find((f) => f.owner?.login === login);
    return existing?.full_name ?? null;
  } catch {
    return null;
  }
}

// ── Unauthenticated GitHub API (for public repo indexing) ──

/**
 * Parse a GitHub URL into owner and repo.
 */
export function parseRepoUrl(url: string): { owner: string; repo: string } {
  const m = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#]|$)/i);
  if (m) return { owner: m[1], repo: m[2] };
  throw new Error("Invalid GitHub URL. Expected https://github.com/owner/repo");
}

/**
 * Get repository metadata (unauthenticated).
 */
export async function getRepoMeta(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<{
  fullName: string;
  defaultBranch: string;
  description: string;
  isPublic: boolean;
  language: string;
  topics: string[];
  stars: number;
  openIssuesCount: number;
  license: string | null;
  fileCount: number;
}> {
  const { data: meta } = await ghApi<any>(`/repos/${owner}/${repo}`, {}, token, 2);
  return {
    fullName: meta.full_name,
    defaultBranch: meta.default_branch ?? "main",
    description: meta.description ?? "",
    isPublic: !meta.private,
    language: meta.language ?? "",
    topics: meta.topics ?? [],
    stars: meta.stargazers_count ?? 0,
    openIssuesCount: meta.open_issues_count ?? 0,
    license: meta.license?.spdx_id ?? null,
    fileCount: 0, // filled later by indexRepo
  };
}

/**
 * Check for CONTRIBUTING.md or CONTRIBUTING file in the repo.
 */
export async function hasContributingFile(
  owner: string,
  repo: string,
  branch: string,
): Promise<boolean> {
  const candidates = ["CONTRIBUTING.md", "CONTRIBUTING", ".github/CONTRIBUTING.md"];
  for (const c of candidates) {
    const res = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${c}`,
      { headers: { "User-Agent": USER_AGENT } },
    );
    if (res.ok) return true;
  }
  return false;
}

/**
 * Fetch open GitHub issues labeled "good first issue" or "help wanted".
 */
export async function fetchLabeledIssues(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<{ number: number; title: string; body: string; url: string; labels: string[] }[]> {
  try {
    const labels = ["good+first+issue", "help+wanted"];
    const results: any[] = [];
    for (const label of labels) {
      const { data: issues } = await ghApi<any[]>(
        `/repos/${owner}/${repo}/issues?state=open&labels=${label}&per_page=20`,
        {},
        token,
        2,
      );
      results.push(...issues);
    }
    return results
      .filter((i: any) => !i.pull_request) // exclude PRs
      .map((i: any) => ({
        number: i.number,
        title: i.title,
        body: (i.body ?? "").slice(0, 2000),
        url: i.html_url,
        labels: i.labels.map((l: any) => l.name),
      }));
  } catch {
    return [];
  }
}

/**
 * Index repository files (sampled) — adapted from existing code.
 */
export async function indexRepo(
  owner: string,
  repo: string,
  defaultBranch: string,
  token?: string | null,
): Promise<{
  tree: { path: string; type: string; size: number }[];
  fileContents: Record<string, string>;
  readme: string;
  packageJson: string | null;
  totalBytes: number;
}> {
  // Get the tree (recursive). Fall back to a shallow tree if too large.
  let tree: any;
  try {
    tree = await ghApi(
      `/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`,
      {},
      token,
      2,
    );
  } catch {
    tree = { tree: [] };
  }

  let entries: { path: string; type: string; size: number }[] = tree.data?.tree ?? [];
  if (tree.data?.truncated) {
    const top = await ghApi(`/repos/${owner}/${repo}/contents`, {}, token, 2);
    entries = (top.data as any[]).map((f: any) => ({
      path: f.path,
      type: f.type,
      size: f.size ?? 0,
    }));
  }

  // Filter to source-ish files, cap count + size for the LLM context budget.
  const codeExt = /\.(ts|tsx|js|jsx|py|rb|go|rs|java|kt|c|cc|cpp|h|hpp|cs|php|swift|m|scala|sh|yml|yaml|json|toml|md|sql|css|scss|html|vue|svelte)$/i;
  const skip = /(^|\/)(node_modules|vendor|dist|build|\.git|\.next|target|__pycache__|venv|\.venv|coverage)\//i;
  const candidates = entries
    .filter((e) => e.type === "blob" && codeExt.test(e.path) && !skip.test(e.path))
    .sort((a, b) => a.size - b.size)
    .slice(0, 40);

  // Fetch file contents — cap each file to ~6KB
  const fileContents: Record<string, string> = {};
  let totalBytes = 0;
  const MAX_TOTAL = 60000;
  for (const f of candidates) {
    if (totalBytes > MAX_TOTAL) break;
    try {
      const raw = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/${f.path}`,
        { headers: { "User-Agent": USER_AGENT } },
      );
      if (!raw.ok) continue;
      let text = await raw.text();
      if (text.length > 6000) text = text.slice(0, 6000) + "\n/* …truncated… */\n";
      fileContents[f.path] = text;
      totalBytes += text.length;
    } catch {
      // skip unreadable files
    }
  }

  // README + package.json
  let readme = "";
  try {
    const r = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/README.md`,
      { headers: { "User-Agent": USER_AGENT } },
    );
    if (r.ok) readme = (await r.text()).slice(0, 4000);
  } catch { /* ignore */ }

  let packageJson: string | null = null;
  try {
    const p = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/package.json`,
      { headers: { "User-Agent": USER_AGENT } },
    );
    if (p.ok) packageJson = (await p.text()).slice(0, 4000);
  } catch { /* ignore */ }

  return {
    tree: entries.map((e) => ({ path: e.path, type: e.type, size: e.size })),
    fileContents,
    readme,
    packageJson,
    totalBytes,
  };
}

// ── Helpers ──

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
