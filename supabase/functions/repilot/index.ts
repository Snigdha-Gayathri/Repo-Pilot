// RepoPilot AI — orchestration edge function.
// Clones (via GitHub tree API) + indexes a public repo, then runs a team of six
// AI agents (LangGraph-style DAG) using the Gemini API, persisting live progress
// to Supabase so the frontend can render execution in real time.
//
// Agents:
//   1. Repository Analyst  — structure, frameworks, deps, conventions
//   2. Issue Hunter         — bugs, TODOs, smells, missing tests, security, beginner-friendly
//   3. Solution Architect   — implementation strategies w/ tradeoffs, complexity, risk, confidence
//   4. Code Engineer        — production-quality code in repo's style (>=2 impls for important issues)
//   5. QA Agent             — review + generate unit/integration tests
//   6. Reviewer Agent       — compare proposals, score, select best, justify
//
// All AI reasoning uses ONLY the Gemini API. The key is read from the
// GEMINI_API_KEY env var (server-side secret, never exposed to the client).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SUPA_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type AgentName =
  | "repository_analyst"
  | "issue_hunter"
  | "solution_architect"
  | "code_engineer"
  | "qa_agent"
  | "reviewer";

const AGENT_LABELS: Record<AgentName, string> = {
  repository_analyst: "Repository Analyst",
  issue_hunter: "Issue Hunter",
  solution_architect: "Solution Architect",
  code_engineer: "Code Engineer",
  qa_agent: "QA Agent",
  reviewer: "Reviewer",
};

interface RepoIndex {
  full_name: string;
  default_branch: string;
  description: string;
  language: string;
  languages: string[];
  tree: { path: string; type: string; size: number }[];
  fileContents: Record<string, string>;
  readme: string;
  packageJson: string | null;
  fileCount: number;
  totalBytes: number;
}

// ---------------------------------------------------------------------------
// Gemini call helper — strict JSON output
// ---------------------------------------------------------------------------
async function gemini(prompt: string, system?: string): Promise<string> {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY not configured");
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      topP: 0.95,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
  };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }
  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return text;
}

async function geminiJSON<T>(prompt: string, system?: string): Promise<T> {
  const raw = await gemini(prompt, system);
  // Strip code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(cleaned) as T;
}

// ---------------------------------------------------------------------------
// Supabase persistence helpers
// ---------------------------------------------------------------------------
function makeSupa() {
  return createClient(SUPA_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function startEvent(
  supa: ReturnType<typeof makeSupa>,
  runId: string,
  agent: AgentName,
  phase: string,
  message: string
): Promise<string> {
  const { data, error } = await supa
    .from("agent_events")
    .insert({ run_id: runId, agent, phase, status: "running", message })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function finishEvent(
  supa: ReturnType<typeof makeSupa>,
  eventId: string,
  status: string,
  output: unknown,
  startedAt: string
) {
  const endedAt = new Date().toISOString();
  const duration = Date.parse(endedAt) - Date.parse(startedAt);
  await supa
    .from("agent_events")
    .update({ status, output, ended_at: endedAt, duration_ms: duration })
    .eq("id", eventId);
}

async function updateRun(
  supa: ReturnType<typeof makeSupa>,
  runId: string,
  patch: Record<string, unknown>
) {
  await supa.from("analysis_runs").update(patch).eq("id", runId);
}

// ---------------------------------------------------------------------------
// GitHub repo indexing (read-only, no auth needed for public repos)
// ---------------------------------------------------------------------------
function parseRepoUrl(url: string): { owner: string; repo: string } {
  const m = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#]|$)/i);
  if (m) return { owner: m[1], repo: m[2] };
  throw new Error("Invalid GitHub URL. Expected https://github.com/owner/repo");
}

async function ghApi(path: string): Promise<any> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "RepoPilot-AI",
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GitHub API ${res.status} for ${path}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

async function indexRepo(owner: string, repo: string): Promise<RepoIndex> {
  const meta = await ghApi(`/repos/${owner}/${repo}`);
  const defaultBranch = meta.default_branch ?? "main";

  // Get the tree (recursive). Fall back to a shallow tree if too large.
  let tree = await ghApi(
    `/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`
  );
  let entries: { path: string; type: string; size: number }[] = tree.tree ?? [];
  if (tree.truncated) {
    // Fallback: fetch top-level contents only
    const top = await ghApi(`/repos/${owner}/${repo}/contents`);
    entries = (top as any[]).map((f) => ({
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

  // Fetch file contents (raw) — cap each file to ~6KB to stay in budget.
  const fileContents: Record<string, string> = {};
  let totalBytes = 0;
  const MAX_TOTAL = 60000;
  for (const f of candidates) {
    if (totalBytes > MAX_TOTAL) break;
    try {
      const raw = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/${f.path}`,
        { headers: { "User-Agent": "RepoPilot-AI" } }
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
      `https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/README.md`
    );
    if (r.ok) readme = (await r.text()).slice(0, 4000);
  } catch {
    /* ignore */
  }
  let packageJson: string | null = null;
  try {
    const p = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/package.json`
    );
    if (p.ok) packageJson = (await p.text()).slice(0, 4000);
  } catch {
    /* ignore */
  }

  // Languages
  let languages: string[] = [];
  try {
    const langs = await ghApi(`/repos/${owner}/${repo}/languages`);
    languages = Object.keys(langs);
  } catch {
    /* ignore */
  }

  return {
    full_name: meta.full_name,
    default_branch: defaultBranch,
    description: meta.description ?? "",
    language: meta.language ?? "",
    languages,
    tree: entries.map((e) => ({ path: e.path, type: e.type, size: e.size })),
    fileContents,
    readme,
    packageJson,
    fileCount: entries.filter((e) => e.type === "blob").length,
    totalBytes,
  };
}

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

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------
const SYSTEM_BASE =
  "You are part of RepoPilot AI, a multi-agent system that analyzes public GitHub repositories and proposes high-quality contributions. Always respond with valid JSON matching the requested schema. Be specific, cite file paths, and ground every claim in the provided repository content.";

async function agentRepositoryAnalyst(
  supa: ReturnType<typeof makeSupa>,
  runId: string,
  idx: RepoIndex
): Promise<any> {
  const evId = await startEvent(
    supa,
    runId,
    "repository_analyst",
    "analyze",
    "Reading repository structure, dependencies, and conventions…"
  );
  const startedAt = new Date().toISOString();
  try {
    const prompt = `Analyze this repository and produce a structured overview.

${buildIndexDigest(idx)}

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
  "techStack": ["..."]
}`;
    const result = await geminiJSON<any>(prompt, SYSTEM_BASE);
    await finishEvent(supa, evId, "done", result, startedAt);
    return result;
  } catch (e) {
    await finishEvent(supa, evId, "error", { error: String(e) }, startedAt);
    throw e;
  }
}

async function agentIssueHunter(
  supa: ReturnType<typeof makeSupa>,
  runId: string,
  idx: RepoIndex,
  analyst: any
): Promise<any[]> {
  const evId = await startEvent(
    supa,
    runId,
    "issue_hunter",
    "scan",
    "Hunting for bugs, TODOs, code smells, security risks, and contribution opportunities…"
  );
  const startedAt = new Date().toISOString();
  try {
    const prompt = `You are the Issue Hunter. Scan the repository below and identify concrete, actionable issues a contributor could fix. Look for: bugs, TODOs/FIXMEs, code smells, duplicated logic, missing documentation, missing tests, performance issues, security risks, and beginner-friendly opportunities. Prioritize issues that are real and fixable.

Repository overview:
${JSON.stringify(analyst).slice(0, 3000)}

${buildIndexDigest(idx)}

Return JSON: { "issues": [ { "title": "...", "description": "detailed description of the issue and why it matters", "category": "bug|todo|smell|duplication|docs|tests|performance|security|beginner", "severity": "critical|high|medium|low", "confidence": 0-1 number, "filesAffected": ["paths"], "estimatedEffort": "e.g. '2-4 hours'", "isImportant": boolean (true if it warrants two independent implementations) } ] }
Return between 4 and 8 issues, ordered by severity then confidence. Ground each issue in specific files from the repository.`;
    const result = await geminiJSON<{ issues: any[] }>(prompt, SYSTEM_BASE);
    const issues = (result.issues ?? []).map((i: any) => ({
      ...i,
      files_affected: i.filesAffected ?? i.files_affected ?? [],
      estimated_effort: i.estimatedEffort ?? i.estimated_effort,
      is_important: !!i.isImportant,
    }));
    await finishEvent(
      supa,
      evId,
      "done",
      { issueCount: issues.length },
      startedAt
    );
    return issues;
  } catch (e) {
    await finishEvent(supa, evId, "error", { error: String(e) }, startedAt);
    throw e;
  }
}

async function agentSolutionArchitect(
  supa: ReturnType<typeof makeSupa>,
  runId: string,
  issue: any,
  idx: RepoIndex,
  analyst: any
): Promise<any[]> {
  const evId = await startEvent(
    supa,
    runId,
    "solution_architect",
    "design",
    `Designing implementation strategies for: ${issue.title}`
  );
  const startedAt = new Date().toISOString();
  try {
    const n = issue.is_important ? 2 : 1;
    const prompt = `You are the Solution Architect. For the issue below, propose ${n} distinct implementation strateg${n > 1 ? "ies" : "y"}.

Repository conventions:
${JSON.stringify(analyst.conventions ?? {}).slice(0, 800)}

Issue:
${JSON.stringify(issue)}

Relevant file contents:
${Object.entries(idx.fileContents)
  .filter(([p]) => (issue.files_affected ?? []).some((f: string) => p.includes(f) || f.includes(p)))
  .map(([p, c]) => `--- ${p} ---\n${c}`)
  .join("\n\n")}

Return JSON: { "strategies": [ { "approach": "short name", "description": "detailed implementation plan", "tradeoffs": ["..."], "complexity": "low|medium|high", "risk": "low|medium|high", "confidence": 0-1 } ] }
Each strategy must be genuinely different (not a rewording).`;
    const result = await geminiJSON<{ strategies: any[] }>(prompt, SYSTEM_BASE);
    await finishEvent(supa, evId, "done", { count: result.strategies?.length }, startedAt);
    return result.strategies ?? [];
  } catch (e) {
    await finishEvent(supa, evId, "error", { error: String(e) }, startedAt);
    throw e;
  }
}

async function agentCodeEngineer(
  supa: ReturnType<typeof makeSupa>,
  runId: string,
  issue: any,
  strategy: any,
  idx: RepoIndex,
  analyst: any
): Promise<any> {
  const evId = await startEvent(
    supa,
    runId,
    "code_engineer",
    "implement",
    `Implementing "${strategy.approach}" for: ${issue.title}`
  );
  const startedAt = new Date().toISOString();
  try {
    const relevantFiles = Object.entries(idx.fileContents)
      .filter(([p]) =>
        (issue.files_affected ?? []).some((f: string) => p.includes(f) || f.includes(p))
      )
      .map(([p, c]) => `--- FILE: ${p} ---\n${c}`)
      .join("\n\n");
    const prompt = `You are the Code Engineer. Implement the strategy below as a unified diff that a maintainer could review and apply. Follow the repository's existing style and conventions exactly.

Repository conventions:
${JSON.stringify(analyst.conventions ?? {}).slice(0, 800)}

Issue:
${JSON.stringify(issue)}

Strategy to implement:
${JSON.stringify(strategy)}

Current file contents:
${relevantFiles || "(files not fetched — infer from tree)"}

Produce a unified diff in standard git format. Each hunk header must use \`--- a/path\` and \`+++ b/path\` with @@ line markers. Only modify files necessary for this fix. Do not invent file contents — base changes on the provided files.

Return JSON: { "approach": "${strategy.approach}", "diff": "the full unified diff string", "files": ["paths touched"], "notes": "brief explanation of what changed and why" }`;
    const result = await geminiJSON<any>(prompt, SYSTEM_BASE);
    await finishEvent(supa, evId, "done", { files: result.files }, startedAt);
    return result;
  } catch (e) {
    await finishEvent(supa, evId, "error", { error: String(e) }, startedAt);
    throw e;
  }
}

async function agentQA(
  supa: ReturnType<typeof makeSupa>,
  runId: string,
  issue: any,
  proposal: any,
  idx: RepoIndex,
  analyst: any
): Promise<any> {
  const evId = await startEvent(
    supa,
    runId,
    "qa_agent",
    "review",
    `Reviewing implementation and generating tests for: ${issue.title}`
  );
  const startedAt = new Date().toISOString();
  try {
    const prompt = `You are the QA Agent. Review the proposed code change and generate appropriate tests.

Repository conventions (testing):
${JSON.stringify(analyst.conventions?.testing ?? "unknown").slice(0, 600)}

Issue:
${JSON.stringify(issue)}

Proposed diff:
${proposal.diff}

Return JSON: {
  "regressions": ["potential regression risks, or empty array if none"],
  "testStrategy": "description of the testing approach",
  "tests": "the full test file content as a single string, ready to save",
  "testFile": "suggested path for the test file",
  "verdict": "approve|request-changes",
  "notes": "review notes"
}`;
    const result = await geminiJSON<any>(prompt, SYSTEM_BASE);
    await finishEvent(supa, evId, "done", { verdict: result.verdict }, startedAt);
    return result;
  } catch (e) {
    await finishEvent(supa, evId, "error", { error: String(e) }, startedAt);
    throw e;
  }
}

async function agentReviewer(
  supa: ReturnType<typeof makeSupa>,
  runId: string,
  issue: any,
  proposals: any[]
): Promise<any> {
  const evId = await startEvent(
    supa,
    runId,
    "reviewer",
    "evaluate",
    `Comparing ${proposals.length} proposal(s) and selecting the best for: ${issue.title}`
  );
  const startedAt = new Date().toISOString();
  try {
    const prompt = `You are the Reviewer Agent. Evaluate the implementation proposals below for the given issue. Compare them on code quality, correctness, risk, testability, and alignment with the issue. Select the best one and justify.

Issue:
${JSON.stringify(issue)}

Proposals:
${JSON.stringify(
  proposals.map((p, i) => ({
    index: i,
    approach: p.approach,
    diff: p.diff,
    qaVerdict: p.qa?.verdict,
    qaNotes: p.qa?.notes,
  }))
)}

Return JSON: {
  "selectedIndex": 0-based index of the best proposal,
  "scores": [ { "index": 0, "score": 0-100, "rationale": "..." } ],
  "recommendation": {
    "summary": "clear justification for the selected proposal",
    "confidence": 0-1,
    "conditions": ["any conditions or follow-ups"]
  }
}`;
    const result = await geminiJSON<any>(prompt, SYSTEM_BASE);
    await finishEvent(supa, evId, "done", result, startedAt);
    return result;
  } catch (e) {
    await finishEvent(supa, evId, "error", { error: String(e) }, startedAt);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Orchestration (LangGraph-style DAG)
// ---------------------------------------------------------------------------
async function orchestrate(runId: string, repoUrl: string) {
  const supa = makeSupa();

  // Phase 0: clone + index
  const evIndex = await startEvent(
    supa,
    runId,
    "repository_analyst",
    "index",
    "Cloning and indexing repository via GitHub API…"
  );
  const indexStart = new Date().toISOString();
  let idx: RepoIndex;
  try {
    const { owner, repo } = parseRepoUrl(repoUrl);
    idx = await indexRepo(owner, repo);
    await updateRun(supa, runId, {
      repo_full_name: idx.full_name,
      default_branch: idx.default_branch,
      status: "analyzing",
    });
    await finishEvent(
      supa,
      evIndex,
      "done",
      { files: idx.fileCount, sampled: Object.keys(idx.fileContents).length },
      indexStart
    );
  } catch (e) {
    await finishEvent(supa, evIndex, "error", { error: String(e) }, indexStart);
    await updateRun(supa, runId, { status: "error", error: String(e) });
    return;
  }

  try {
    // Agent 1: Repository Analyst
    const analyst = await agentRepositoryAnalyst(supa, runId, idx);
    await updateRun(supa, runId, { summary: analyst });

    // Agent 2: Issue Hunter
    const rawIssues = await agentIssueHunter(supa, runId, idx, analyst);

    // Persist issues
    const issueRows = rawIssues.map((i: any) => ({
      run_id: runId,
      title: i.title,
      description: i.description,
      category: i.category,
      severity: i.severity,
      confidence: i.confidence,
      files_affected: i.files_affected ?? [],
      estimated_effort: i.estimated_effort,
      suggested_solutions: [],
      is_important: !!i.is_important,
    }));
    const { data: insertedIssues, error: ie } = await supa
      .from("issues")
      .insert(issueRows)
      .select("id, title, is_important");
    if (ie) throw ie;
    const issues = insertedIssues ?? [];

    // For each issue: Architect -> Engineer (>=2 for important) -> QA -> Reviewer
    for (const issue of issues) {
      const issueInput = rawIssues.find((r: any) => r.title === issue.title) ?? rawIssues[0];

      // Agent 3: Solution Architect
      const strategies = await agentSolutionArchitect(supa, runId, issueInput, idx, analyst);

      // Agent 4: Code Engineer — one proposal per strategy
      const proposals: any[] = [];
      for (const s of strategies) {
        const proposal = await agentCodeEngineer(supa, runId, issueInput, s, idx, analyst);
        // Agent 5: QA Agent
        const qa = await agentQA(supa, runId, issueInput, proposal, idx, analyst);
        proposals.push({ ...proposal, qa });
      }
      // Ensure at least one proposal
      if (proposals.length === 0) {
        const fallback = await agentCodeEngineer(supa, runId, issueInput, strategies[0] ?? { approach: "Direct fix" }, idx, analyst);
        const qa = await agentQA(supa, runId, issueInput, fallback, idx, analyst);
        proposals.push({ ...fallback, qa });
      }

      // Agent 6: Reviewer
      const review = await agentReviewer(supa, runId, issueInput, proposals);
      const selectedIdx = Math.max(0, Math.min(proposals.length - 1, review.selectedIndex ?? 0));

      // Persist proposals
      const proposalRows = proposals.map((p, i) => ({
        issue_id: issue.id,
        run_id: runId,
        approach: p.approach,
        tradeoffs: [],
        complexity: strategies[i]?.complexity ?? "medium",
        risk: strategies[i]?.risk ?? "medium",
        confidence: strategies[i]?.confidence ?? 0.7,
        diff: p.diff ?? "",
        files: p.files ?? [],
        tests: p.qa?.tests ?? "",
        qa_notes: p.qa ?? null,
        reviewer_score: review.scores?.[i]?.score ?? null,
        reviewer_notes: review.scores?.[i]?.rationale ?? null,
        is_selected: i === selectedIdx,
      }));
      const { data: insertedProposals, error: pe } = await supa
        .from("proposals")
        .insert(proposalRows)
        .select("id, is_selected");
      if (pe) throw pe;

      const selectedId = insertedProposals?.find((p) => p.is_selected)?.id ?? insertedProposals?.[0]?.id;
      await supa
        .from("issues")
        .update({
          suggested_solutions: strategies,
          reviewer_recommendation: review.recommendation ?? review,
          selected_proposal_id: selectedId,
        })
        .eq("id", issue.id);
    }

    await updateRun(supa, runId, { status: "completed" });
  } catch (e) {
    await updateRun(supa, runId, { status: "error", error: String(e) });
  }
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "analyze";

    if (action === "analyze") {
      const { repo_url, run_id } = await req.json();
      if (!repo_url || !run_id) {
        return new Response(JSON.stringify({ error: "repo_url and run_id required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Run orchestration in the background so the request returns immediately;
      // the frontend watches progress via Supabase realtime on agent_events.
      const waitUntil = (globalThis as any).EdgeRuntime?.waitUntil ?? ((p: Promise<unknown>) => void p.catch(() => {}));
      waitUntil(orchestrate(run_id, repo_url));
      return new Response(JSON.stringify({ ok: true, run_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "github_oauth_start") {
      const clientId = Deno.env.get("GITHUB_OAUTH_CLIENT_ID");
      const redirect = url.searchParams.get("redirect_uri") ?? `${url.origin}/repilot`;
      if (!clientId) {
        return new Response(JSON.stringify({ error: "GitHub OAuth not configured" }), {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const state = crypto.randomUUID();
      const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo%20read:org&state=${state}&redirect_uri=${encodeURIComponent(redirect)}`;
      return new Response(JSON.stringify({ auth_url: authUrl, state }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "github_oauth_callback") {
      const { code, run_id, approved_files } = await req.json();
      const clientId = Deno.env.get("GITHUB_OAUTH_CLIENT_ID");
      const clientSecret = Deno.env.get("GITHUB_OAUTH_CLIENT_SECRET");
      if (!clientId || !clientSecret) {
        return new Response(JSON.stringify({ error: "GitHub OAuth not configured" }), {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      });
      const tokenData = await tokenRes.json();
      if (tokenData.error) {
        return new Response(JSON.stringify({ error: tokenData.error }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const ghToken = tokenData.access_token;
      const userRes = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${ghToken}`, "User-Agent": "RepoPilot-AI" },
      });
      const user = await userRes.json();

      // Create PR with approved files
      const prResult = await createPullRequest(supa(), run_id, ghToken, user.login, approved_files ?? []);
      return new Response(JSON.stringify({ user: { login: user.login }, ...prResult }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ---------------------------------------------------------------------------
// Create Pull Request: fork (if needed), branch, commit, push, open PR
// ---------------------------------------------------------------------------
async function createPullRequest(
  supa: ReturnType<typeof makeSupa>,
  runId: string,
  ghToken: string,
  login: string,
  approvedFiles: { path: string; content: string }[]
) {
  const evId = await startEvent(supa, runId, "reviewer", "pr", "Creating pull request on GitHub…");
  const startedAt = new Date().toISOString();
  const gh = (path: string, opts: RequestInit = {}) =>
    fetch(`https://api.github.com${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "RepoPilot-AI",
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
    });

  try {
    const { data: run } = await supa.from("analysis_runs").select("*").eq("id", runId).single();
    if (!run) throw new Error("run not found");
    const [owner, repo] = (run.repo_full_name ?? "").split("/");

    // 1. Fork if the user doesn't own the repo
    let forkOwner = owner;
    let forkRepo = repo;
    if (owner !== login) {
      const forkRes = await gh(`/repos/${owner}/${repo}/forks`, { method: "POST" });
      const fork = await forkRes.json();
      forkOwner = login;
      forkRepo = fork.name ?? repo;
      // wait for fork to be ready
      for (let i = 0; i < 10; i++) {
        const r = await gh(`/repos/${forkOwner}/${forkRepo}`);
        if (r.ok) {
          const j = await r.json();
          if (j.size !== undefined) break;
        }
        await new Promise((res) => setTimeout(res, 2000));
      }
    }

    // 2. Get default branch SHA
    const branchRes = await gh(`/repos/${forkOwner}/${forkRepo}/branches/${run.default_branch ?? "main"}`);
    const branch = await branchRes.json();
    const baseSha = branch?.commit?.sha;
    if (!baseSha) throw new Error("could not resolve base branch SHA");

    // 3. Create a new branch
    const newBranch = `repopilot/${runId.slice(0, 8)}`;
    await gh(`/repos/${forkOwner}/${forkRepo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: baseSha }),
    });

    // 4. Commit each approved file via the contents API
    for (const f of approvedFiles) {
      const content = btoa(unescape(encodeURIComponent(f.content)));
      await gh(`/repos/${forkOwner}/${forkRepo}/contents/${f.path}`, {
        method: "PUT",
        body: JSON.stringify({
          message: `fix: ${f.path} (RepoPilot AI)`,
          content,
          branch: newBranch,
        }),
      });
    }

    // 5. Open a pull request
    const prRes = await gh(`/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: "RepoPilot AI: proposed contributions",
        head: `${forkOwner}:${newBranch}`,
        base: run.default_branch ?? "main",
        body: "Changes proposed by RepoPilot AI after multi-agent analysis and human review.",
      }),
    });
    const pr = await prRes.json();

    await supa.from("pr_requests").insert({
      run_id: runId,
      github_login: login,
      fork_url: `https://github.com/${forkOwner}/${forkRepo}`,
      branch_name: newBranch,
      pr_url: pr.html_url,
      pr_number: pr.number,
      status: prRes.ok ? "created" : "error",
      approved_files: approvedFiles,
    });

    await finishEvent(supa, evId, prRes.ok ? "done" : "error", { pr_url: pr.html_url }, startedAt);
    if (!prRes.ok) throw new Error(pr.message ?? "PR creation failed");
    return { pr_url: pr.html_url, pr_number: pr.number, branch: newBranch };
  } catch (e) {
    await finishEvent(supa, evId, "error", { error: String(e) }, startedAt);
    return { error: String(e) };
  }
}
