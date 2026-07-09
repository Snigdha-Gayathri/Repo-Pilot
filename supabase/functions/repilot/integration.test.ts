// ---------------------------------------------------------------------------
// Integration tests for the full LangGraph pipeline
// Mocks: GitHub API, Gemini API, raw.githubusercontent.com, Supabase REST
// Tests: Full pipeline from intake → ranking, plus error paths
// ---------------------------------------------------------------------------
import { assertEquals, assertStringIncludes, assert } from "jsr:@std/assert";
import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { RepoPilotState } from "./state.ts";
// Import real node functions
import { intakeAgent } from "./nodes/intake.ts";
import { repoAnalysisAgent } from "./nodes/repo-analysis.ts";
import { issueDiscoveryAgent } from "./nodes/issue-discovery.ts";
import { rankingAgent } from "./nodes/ranking.ts";
import { codeGenerationAgent } from "./nodes/code-generation.ts";
import { codeReviewAgent } from "./nodes/code-review.ts";
import { prAgent } from "./nodes/pr-agent.ts";

// ── Test constants ──
const RUN_ID = "test-integration-run-001";
const REPO_URL = "https://github.com/facebook/react";
const GITHUB_TOKEN = "github_pat_test_token_123";
const ORIGINAL_FETCH = globalThis.fetch;

// ── URL matchers ──
const GITHUB_API = "https://api.github.com";
const RAW_GITHUB = "https://raw.githubusercontent.com";
const GEMINI_API = "https://generativelanguage.googleapis.com";

// ── Setup / Teardown ──
function setupTestEnv() {
  Deno.env.set("GITHUB_TOKEN", GITHUB_TOKEN);
  Deno.env.set("SUPABASE_URL", "https://test-project.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
  Deno.env.set("GEMINI_API_KEY", "test-gemini-key");
}

function teardownTestEnv() {
  Deno.env.delete("GITHUB_TOKEN");
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.delete("GEMINI_API_KEY");
  globalThis.fetch = ORIGINAL_FETCH;
}

// ── Supabase call tracker ──
interface SupabaseCall {
  table: string;
  method: string;
  body: unknown;
  url?: string;
}
const supabaseCalls: SupabaseCall[] = [];

function resetSupabaseCalls() {
  supabaseCalls.length = 0;
}

// ── Mock response builders ──

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-RateLimit-Remaining": "42",
      "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 3600),
      "X-RateLimit-Limit": "60",
      "X-OAuth-Scopes": "repo, workflow",
      ...extraHeaders,
    },
  });
}

/** Pre-computed Gemini response for Repo Analysis Agent */
const GEMINI_ANALYSIS_RESPONSE = JSON.stringify({
  summary: "React is a JavaScript library for building user interfaces.",
  architecture: "Component-based architecture with virtual DOM",
  frameworks: ["React"],
  dependencies: ["react", "react-dom"],
  languages: ["TypeScript", "JavaScript", "CSS"],
  conventions: { naming: "camelCase", structure: "components in src/", testing: "Jest", style: "functional components" },
  entryPoints: ["src/index.ts"],
  techStack: ["React", "TypeScript", "Jest"],
  qualitySignals: { hasTests: true, testFramework: "Jest", hasCi: true, hasLintConfig: true, readmeQuality: "excellent" },
});

/** Pre-computed Gemini response for Issue Discovery Agent */
const GEMINI_ISSUES_RESPONSE = JSON.stringify({
  issues: [
    { title: "Missing error boundary in App component", description: "The App component doesn't have an error boundary", category: "bug", severity: "high", confidence: 0.85, filesAffected: ["src/App.tsx"], estimatedEffort: "1-2 hours", isImportant: true },
    { title: "TODO: Add loading state", description: "Several components lack loading states", category: "todo", severity: "medium", confidence: 0.7, filesAffected: ["src/App.tsx"], estimatedEffort: "2-3 hours", isImportant: false },
    { title: "Duplicate type definitions", description: "TypeScript types are duplicated across files", category: "duplication", severity: "medium", confidence: 0.65, filesAffected: ["src/index.ts"], estimatedEffort: "1 hour", isImportant: false },
    { title: "Missing test for core utility", description: "Core utility functions have no test coverage", category: "tests", severity: "high", confidence: 0.8, filesAffected: ["src/index.ts"], estimatedEffort: "3-4 hours", isImportant: true },
  ],
});

/** Pre-computed Gemini response for Ranking Agent */
const GEMINI_RANKING_RESPONSE = JSON.stringify({
  rankedIssues: [
    { issueIndex: 0, scores: { impact: 80, difficulty: 30, acceptanceLikelihood: 90, alignmentWithGuidelines: 85 }, overallScore: 78.5, rationale: "High impact bug with clear fix" },
    { issueIndex: 3, scores: { impact: 75, difficulty: 50, acceptanceLikelihood: 80, alignmentWithGuidelines: 90 }, overallScore: 72.5, rationale: "Important for code quality" },
    { issueIndex: 1, scores: { impact: 40, difficulty: 20, acceptanceLikelihood: 85, alignmentWithGuidelines: 75 }, overallScore: 58.5, rationale: "Useful improvement" },
    { issueIndex: 2, scores: { impact: 30, difficulty: 10, acceptanceLikelihood: 95, alignmentWithGuidelines: 80 }, overallScore: 57.75, rationale: "Quick win" },
  ],
});

/** Pre-computed Gemini response for Code Generation Agent */
const GEMINI_CODE_GEN_RESPONSE = JSON.stringify({
  diff: [
    "diff --git a/src/App.tsx b/src/App.tsx",
    "--- a/src/App.tsx",
    "+++ b/src/App.tsx",
    "@@ -1,3 +1,7 @@",
    "+import { ErrorBoundary } from './ErrorBoundary';",
    "+",
    " export default function App() {",
    "-  return <div>Hello</div>;",
    "+  return <ErrorBoundary><div>Hello</div></ErrorBoundary>;",
    " }",
  ].join("\n"),
  files: ["src/App.tsx"],
  notes: "Added error boundary wrapper to App component",
});

/** Pre-computed Gemini response for Code Review — approve */
const GEMINI_REVIEW_PASS_RESPONSE = JSON.stringify({
  verdict: "approve",
  feedback: null,
  regressions: [],
  testCode: "",
  testFile: null,
  score: 85,
});

/** Pre-computed Gemini response for Code Review — request changes */
const GEMINI_REVIEW_FAIL_RESPONSE = JSON.stringify({
  verdict: "request-changes",
  feedback: "Missing null check on props — add a guard for undefined inputs",
  regressions: ["Could break if props are undefined"],
  testCode: "",
  testFile: null,
  score: 45,
});

function buildMockFetch(): Record<string, (url?: string, init?: RequestInit) => Response | Promise<Response>> {
  const handlers: Record<string, (url?: string, init?: RequestInit) => Response | Promise<Response>> = {};

  // ── GitHub API handlers ──
  handlers["/user"] = () => jsonResponse({ login: "testuser", id: 1 });

  handlers["/rate_limit"] = () => jsonResponse({
    resources: { core: { limit: 60, remaining: 42, reset: Math.floor(Date.now() / 1000) + 3600 } },
  }, 200, { "X-OAuth-Scopes": "repo, workflow" });

  handlers["/repos/facebook/react"] = () => jsonResponse({
    id: 1, full_name: "facebook/react", default_branch: "main",
    description: "A JavaScript library for building user interfaces",
    private: false, language: "JavaScript",
    topics: ["react", "ui", "javascript"],
    stargazers_count: 200000, open_issues_count: 500,
    license: { spdx_id: "MIT" }, size: 10000,
  });

  handlers["/repos/facebook/react/git/trees/main?recursive=1"] = () => jsonResponse({
    sha: "abc123",
    tree: [
      { path: "package.json", type: "blob", size: 500 },
      { path: "README.md", type: "blob", size: 2000 },
      { path: "src/App.tsx", type: "blob", size: 3000 },
      { path: "src/index.ts", type: "blob", size: 1000 },
      { path: "test/App.test.tsx", type: "blob", size: 1500 },
    ],
    truncated: false,
  });

  handlers["/repos/facebook/react/languages"] = () => jsonResponse({
    TypeScript: 80000, JavaScript: 20000, CSS: 5000,
  });

  handlers["/repos/facebook/react/issues?state=open&labels=good+first+issue&per_page=20"] = () =>
    jsonResponse([{ number: 1, title: "Good first issue", body: "Fix a typo", html_url: "https://github.com/facebook/react/issues/1", labels: [{ name: "good first issue" }], pull_request: null }]);

  handlers["/repos/facebook/react/issues?state=open&labels=help+wanted&per_page=20"] = () =>
    jsonResponse([{ number: 2, title: "Help wanted issue", body: "Add documentation", html_url: "https://github.com/facebook/react/issues/2", labels: [{ name: "help wanted" }], pull_request: null }]);

  // ── Supabase REST handlers (with call tracking) ──
  // Note: handlers are matched by checking if the URL contains the key.
  handlers["/agent_events"] = (_url?: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    supabaseCalls.push({ table: "agent_events", method: init?.method ?? "POST", body, url: _url });
    return jsonResponse([{ id: crypto.randomUUID(), ...body }]);
  };

  handlers["/analysis_runs"] = (_url?: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    supabaseCalls.push({ table: "analysis_runs", method: init?.method ?? "PATCH", body, url: _url });
    // Always include repo_full_name for GET requests (needed by pr_agent's getRun call)
    return jsonResponse([{ id: RUN_ID, repo_full_name: "facebook/react", ...body }]);
  };

  handlers["/issues"] = (_url?: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : [];
    supabaseCalls.push({ table: "issues", method: init?.method ?? "POST", body, url: _url });
    const inserted = Array.isArray(body) ? body.map((b: any) => ({ id: crypto.randomUUID(), ...b })) : [{ id: crypto.randomUUID(), ...body }];
    return jsonResponse(inserted);
  };

  handlers["/proposals"] = (_url?: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    supabaseCalls.push({ table: "proposals", method: init?.method ?? "POST", body, url: _url });
    return jsonResponse([{ id: crypto.randomUUID(), is_selected: true }]);
  };

  handlers["/pr_requests"] = (_url?: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    supabaseCalls.push({ table: "pr_requests", method: init?.method ?? "POST", body, url: _url });
    return jsonResponse([{ id: crypto.randomUUID(), ...body }]);
  };

  // ── raw.githubusercontent.com ──
  handlers["raw_README.md"] = () => new Response("# React\nA JavaScript library for building UIs.", { status: 200 });
  handlers["raw_package.json"] = () => new Response(JSON.stringify({ name: "react", version: "18.0.0", dependencies: { react: "^18.0.0" } }), { status: 200, headers: { "Content-Type": "application/json" } });
  handlers["raw_src/App.tsx"] = () => new Response("export default function App() { return <div>Hello</div>; }", { status: 200 });
  handlers["raw_src/index.ts"] = () => new Response("import React from 'react';\nconsole.log('hello');", { status: 200 });
  handlers["raw_CONTRIBUTING.md"] = () => new Response("## Contributing\nPlease read the guidelines.", { status: 200 });

  // ── Gemini API handlers (responses pre-computed to avoid bracket issues) ──
  handlers["gemini_analysis"] = () => jsonResponse({
    candidates: [{ content: { parts: [{ text: GEMINI_ANALYSIS_RESPONSE }] } }],
  });

  handlers["gemini_issues"] = () => jsonResponse({
    candidates: [{ content: { parts: [{ text: GEMINI_ISSUES_RESPONSE }] } }],
  });

  handlers["gemini_ranking"] = () => jsonResponse({
    candidates: [{ content: { parts: [{ text: GEMINI_RANKING_RESPONSE }] } }],
  });

  // ── Gemini: Code Generation Agent ──
  handlers["gemini_code_generation"] = () => jsonResponse({
    candidates: [{ content: { parts: [{ text: GEMINI_CODE_GEN_RESPONSE }] } }],
  });

  // ── Gemini: Code Review Agent — retry-aware (call-count tracked via closure) ──
  let codeReviewCallCount = 0;
  handlers["gemini_code_review"] = () => {
    codeReviewCallCount++;
    const response = codeReviewCallCount >= 2 ? GEMINI_REVIEW_PASS_RESPONSE : GEMINI_REVIEW_FAIL_RESPONSE;
    return jsonResponse({
      candidates: [{ content: { parts: [{ text: response }] } }],
    });
  };

  // ── GitHub API: fork check for pr_agent ──
  handlers["/repos/facebook/react/forks"] = () => jsonResponse([
    { full_name: "testuser/react", owner: { login: "testuser" } },
  ]);

  handlers["/repos/testuser/react/branches/main"] = () => jsonResponse({
    name: "main",
    commit: { sha: "base-sha-123" },
  });

  handlers["/repos/testuser/react/git/refs"] = (_url?: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return jsonResponse({ ref: "refs/heads/repopilot/TEST123", object: { sha: "new-sha-456" } });
    }
    return handlers["default"]();
  };

  handlers["/repos/testuser/react/contents"] = () => jsonResponse({
    content: { name: "App.tsx", sha: "file-sha-789" },
  });

  handlers["/repos/facebook/react/pulls"] = () => jsonResponse({
    html_url: "https://github.com/facebook/react/pull/42",
    number: 42,
    message: null,
  });

  // ── Default 404 for unmatched routes ──
  handlers["default"] = () => jsonResponse({ error: "not mocked" }, 404);

  return handlers;
}

function createMockFetch(handlers: Record<string, (url?: string, init?: RequestInit) => Response | Promise<Response>>) {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();

    // GitHub API — strip query params, then exact match, then prefix match
    if (url.startsWith(GITHUB_API)) {
      const path = url.slice(GITHUB_API.length);
      const pathNoQuery = path.split("?")[0];
      // Exact match first
      let handler = handlers[path] ?? handlers[pathNoQuery];
      // Prefix match for dynamic paths (e.g., /contents/, /forks?per_page=50)
      if (!handler) {
        const matchedKey = Object.keys(handlers).find((k) =>
          k !== "default" && pathNoQuery.startsWith(k)
        );
        handler = matchedKey ? handlers[matchedKey] : handlers["default"];
      }
      return Promise.resolve(handler(url, init));
    }

    // Supabase REST — match by table name in URL (handles query params)
    if (url.includes(".supabase.co/rest/v1")) {
      if (url.includes("/agent_events")) return Promise.resolve(handlers["/agent_events"](url, init));
      if (url.includes("/analysis_runs")) return Promise.resolve(handlers["/analysis_runs"](url, init));
      if (url.includes("/issues")) return Promise.resolve(handlers["/issues"](url, init));
      if (url.includes("/proposals")) return Promise.resolve(handlers["/proposals"](url, init));
      if (url.includes("/pr_requests")) return Promise.resolve(handlers["/pr_requests"](url, init));
      return Promise.resolve(handlers["default"](url, init));
    }

    // raw.githubusercontent.com
    if (url.startsWith(RAW_GITHUB)) {
      const path = url.slice(RAW_GITHUB.length);
      const fileName = path.split("/").slice(3).join("/");
      const handler = handlers[`raw_${fileName}`] ?? (() => new Response("Mock content", { status: 200 }));
      return Promise.resolve(handler(url, init));
    }

    // Gemini API — route by prompt content
    if (url.startsWith(GEMINI_API)) {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      const promptText = body?.contents?.[0]?.parts?.[0]?.text ?? "";
      if (promptText.includes("Analyze this repository")) return Promise.resolve(handlers["gemini_analysis"](url, init));
      if (promptText.includes("Issue Hunter")) return Promise.resolve(handlers["gemini_issues"](url, init));
      if (promptText.includes("Ranking Agent")) return Promise.resolve(handlers["gemini_ranking"](url, init));
      if (promptText.includes("Code Engineer")) return Promise.resolve(handlers["gemini_code_generation"](url, init));
      if (promptText.includes("Code Review Agent")) return Promise.resolve(handlers["gemini_code_review"](url, init));
      return Promise.resolve(handlers["default"](url, init));
    }

    return Promise.resolve(handlers["default"](url, init));
  };
}

// ── Build a test graph using the real node functions + MemorySaver ──
function buildTestGraph() {
  return new StateGraph(RepoPilotState);
}

function compileFullPipeline() {
  return buildTestGraph()
    .addNode("intake", intakeAgent)
    .addNode("repo_analysis", repoAnalysisAgent)
    .addNode("issue_discovery", issueDiscoveryAgent)
    .addNode("ranking", rankingAgent)
    .addEdge(START, "intake")
    .addConditionalEdges("intake", (s: any) => s.status === "error" ? END : "repo_analysis")
    .addConditionalEdges("repo_analysis", (s: any) => s.status === "error" ? END : "issue_discovery")
    .addConditionalEdges("issue_discovery", (s: any) => s.status === "error" ? END : "ranking")
    .addEdge("ranking", END)
    .compile({ checkpointer: new MemorySaver() });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Full pipeline — intake → repo_analysis → issue_discovery → ranking
// ─────────────────────────────────────────────────────────────────────────────
Deno.test({
  name: "integration: full pipeline from intake to ranking checkpoint",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    setupTestEnv();
    resetSupabaseCalls();
    const handlers = buildMockFetch();
    globalThis.fetch = createMockFetch(handlers);

    try {
      const graph = compileFullPipeline();
      const config = { configurable: { thread_id: RUN_ID } };
      const finalState = await graph.invoke(
        { runId: RUN_ID, repoUrl: REPO_URL, githubToken: GITHUB_TOKEN } as any,
        config,
      );

      const state = finalState as Record<string, unknown>;

      // State transitions — status was modified by repo_analysis agent (set to "analyzing")
      assertEquals(state.status, "analyzing", "Pipeline should complete without error");
      // error is not set explicitly by any agent on success, so MemorySaver omits it

      // Intake Agent output
      const repoInfo = state.repoInfo as Record<string, unknown>;
      assert(repoInfo, "repoInfo should be populated");
      assertEquals(repoInfo.fullName, "facebook/react");
      assertEquals(repoInfo.isPublic, true);

      // Token verification
      const tv = state.tokenVerification as Record<string, unknown>;
      assert(tv, "tokenVerification should be populated");
      assertEquals(tv.valid, true);
      assertEquals(tv.login, "testuser");

      // Repo Analysis output
      const repoIndex = state.repoIndex as Record<string, unknown>;
      assert(repoIndex, "repoIndex should be populated");
      assert((repoIndex.tree as unknown[]).length > 0, "Tree should have entries");

      const analysis = state.repoAnalysis as Record<string, unknown>;
      assert(analysis, "repoAnalysis should be populated");

      // Issue Discovery output
      const discoveredIssues = state.discoveredIssues as unknown[];
      assert(discoveredIssues.length > 0, "Issues should be discovered");

      // Ranking output
      const rankedIssues = state.rankedIssues as Record<string, unknown>[];
      assert(rankedIssues && rankedIssues.length > 0, "Ranked issues should exist");
      assertEquals(rankedIssues[0].rank, 1);
      assert((rankedIssues[0].overallScore as number) > 0, "Score should be positive");

      // ── Supabase persistence verification ──
      assert(supabaseCalls.filter(c => c.table === "agent_events").length > 0, "Should have persisted agent_events");
      assert(supabaseCalls.filter(c => c.table === "issues").length > 0, "Issues should be persisted to Supabase");
      assert(supabaseCalls.filter(c => c.table === "analysis_runs").length > 0, "Run should be updated");

    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
      teardownTestEnv();
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Private repo rejection
// ─────────────────────────────────────────────────────────────────────────────
Deno.test({
  name: "integration: intake agent rejects private repository",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    setupTestEnv();
    resetSupabaseCalls();
    const handlers = buildMockFetch();

    handlers["/repos/facebook/internal"] = () => jsonResponse({
      id: 2, full_name: "facebook/internal", default_branch: "main",
      description: "Private internal project", private: true,
      language: "TypeScript", topics: [], stargazers_count: 0,
      open_issues_count: 0, license: null, size: 5000,
    });

    globalThis.fetch = createMockFetch(handlers);

    try {
      const graph = buildTestGraph()
        .addNode("intake", intakeAgent)
        .addEdge(START, "intake")
        .addEdge("intake", END)
        .compile({ checkpointer: new MemorySaver() });

      const config = { configurable: { thread_id: `${RUN_ID}-private` } };
      const finalState = await graph.invoke(
        { runId: `${RUN_ID}-private`, repoUrl: "https://github.com/facebook/internal", githubToken: GITHUB_TOKEN } as any,
        config,
      );

      const state = finalState as Record<string, unknown>;
      assertEquals(state.status, "error", "Private repo should cause error");
      assertStringIncludes(String(state.error ?? ""), "private", "Error should mention private");
      // repoInfo was never set by the intake agent on error — LangGraph MemorySaver
      // snapshots omit fields that had defaults but were never modified during execution.
      assertEquals(state.repoInfo, null, "repoInfo should be null on error");
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
      teardownTestEnv();
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Invalid URL rejection
// ─────────────────────────────────────────────────────────────────────────────
Deno.test({
  name: "integration: intake agent rejects invalid GitHub URL",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    setupTestEnv();
    resetSupabaseCalls();
    globalThis.fetch = createMockFetch(buildMockFetch());

    try {
      const graph = buildTestGraph()
        .addNode("intake", intakeAgent)
        .addEdge(START, "intake")
        .addEdge("intake", END)
        .compile({ checkpointer: new MemorySaver() });

      const config = { configurable: { thread_id: `${RUN_ID}-bad-url` } };
      const finalState = await graph.invoke(
        { runId: `${RUN_ID}-bad-url`, repoUrl: "not-a-valid-url", githubToken: GITHUB_TOKEN } as any,
        config,
      );

      const state = finalState as Record<string, unknown>;
      assertEquals(state.status, "error", "Invalid URL should cause error");
      assertStringIncludes(String(state.error ?? ""), "Invalid GitHub URL");
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
      teardownTestEnv();
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: Code generation standalone — verify it produces a diff from mock Gemini
// ─────────────────────────────────────────────────────────────────────────────
Deno.test({
  name: "integration: code generation produces diff from Gemini",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    setupTestEnv();
    resetSupabaseCalls();
    const handlers = buildMockFetch();
    globalThis.fetch = createMockFetch(handlers);

    try {
      const graph = buildTestGraph()
        .addNode("code_generation", codeGenerationAgent)
        .addEdge(START, "code_generation")
        .addConditionalEdges("code_generation", (s: any) =>
          s.status === "error" || !s.generatedDiff ? END : END
        )
        .compile({ checkpointer: new MemorySaver() });

      const prepState = {
        runId: `${RUN_ID}-codegen`,
        repoUrl: REPO_URL,
        githubToken: GITHUB_TOKEN,
        repoInfo: { fullName: "facebook/react", isPublic: true, defaultBranch: "main", owner: "facebook", repo: "react" },
        repoIndex: { full_name: "facebook/react", fileContents: { "src/App.tsx": "export default function App() {}" }, tree: [], fileCount: 0, totalBytes: 0, languages: ["TypeScript"] },
        repoAnalysis: {
          summary: "React library",
          conventions: { naming: "camelCase", testing: "Jest", style: "functional" },
          qualitySignals: { hasTests: true },
        },
        rankedIssues: [{
          rank: 1,
          issue: { title: "Add error boundary", description: "Add error boundary to App", category: "bug", severity: "high", filesAffected: ["src/App.tsx"], estimatedEffort: "1h" },
          scores: { impact: 80, difficulty: 30, acceptanceLikelihood: 90, alignmentWithGuidelines: 85 },
          overallScore: 78.5,
          rationale: "High impact",
        }],
        selectedIssueIndex: 0,
      };

      const config = { configurable: { thread_id: `${RUN_ID}-codegen` } };
      const finalState = await graph.invoke(prepState as any, config);
      const state = finalState as Record<string, unknown>;

      // Code generation should have produced a diff
      assert(state.generatedDiff, "generatedDiff should be set");
      assert((state.generatedDiff as string).includes("diff --git"), "Diff should have standard format");
      assertEquals(state.generationAttempts, 1, "Should have 1 generation attempt");

      // Supabase persistence
      assert(supabaseCalls.filter(c => c.table === "agent_events").length > 0, "Should have persisted agent_events");
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
      teardownTestEnv();
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: Code review approves diff (no retry loop — mock returns approve)
// ─────────────────────────────────────────────────────────────────────────────
Deno.test({
  name: "integration: code generation → code review approves diff",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    setupTestEnv();
    resetSupabaseCalls();
    const handlers = buildMockFetch();
    globalThis.fetch = createMockFetch(handlers);

    try {
      // Single-pass graph: code_gen → code_review → END
      const graph = buildTestGraph()
        .addNode("code_generation", codeGenerationAgent)
        .addNode("code_review", codeReviewAgent)
        .addEdge(START, "code_generation")
        .addConditionalEdges("code_generation", (s: any) =>
          s.status === "error" || !s.generatedDiff ? END : "code_review"
        )
        .addConditionalEdges("code_review", (s: any) =>
          s.status === "error" ? END :
          (s as any).reviewResult?.verdict === "request-changes" && (s as any).reviewRetries < 3 ? "code_generation" :
          END
        )
        .compile({ checkpointer: new MemorySaver() });

      const prepState = {
        runId: `${RUN_ID}-approve`,
        repoUrl: REPO_URL,
        githubToken: GITHUB_TOKEN,
        repoInfo: { fullName: "facebook/react", isPublic: true, defaultBranch: "main", owner: "facebook", repo: "react" },
        repoIndex: { full_name: "facebook/react", fileContents: { "src/App.tsx": "export default function App() {}" }, tree: [], fileCount: 0, totalBytes: 0, languages: ["TypeScript"] },
        repoAnalysis: {
          summary: "React library",
          conventions: { naming: "camelCase", testing: "Jest", style: "functional" },
          qualitySignals: { hasTests: true },
        },
        rankedIssues: [{
          rank: 1,
          issue: { title: "Add error boundary", description: "Add error boundary to App", category: "bug", severity: "high", filesAffected: ["src/App.tsx"], estimatedEffort: "1h" },
          scores: { impact: 80, difficulty: 30, acceptanceLikelihood: 90, alignmentWithGuidelines: 85 },
          overallScore: 78.5,
          rationale: "High impact",
        }],
        selectedIssueIndex: 0,
        // Pre-set review mock counter: 0 means first call returns "request-changes"
        // BUT we want approve directly, so we pre-set the counter via handlers
      };

      // Override the code_review handler to always return approve for this test
      handlers["gemini_code_review"] = () => jsonResponse({
        candidates: [{ content: { parts: [{ text: GEMINI_REVIEW_PASS_RESPONSE }] } }],
      });

      const config = { configurable: { thread_id: `${RUN_ID}-approve` } };
      const finalState = await graph.invoke(prepState as any, config);
      const state = finalState as Record<string, unknown>;

      // Code gen should have produced a diff
      assert(state.generatedDiff, "generatedDiff should be set");
      assert((state.generatedDiff as string).includes("diff --git"), "Diff should be present");

      // Review should have passed
      const reviewResult = state.reviewResult as Record<string, unknown>;
      assert(reviewResult, "Review result should exist");
      assertEquals(reviewResult.verdict, "approve", "Review should approve the diff");
      assertEquals(reviewResult.score, 85, "Score should be preserved from mock");

      // No retries needed — first call returned approve
      assertEquals(state.status, "awaiting_approval", "Approve sets awaiting_approval status");
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
      teardownTestEnv();
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: Code review retry loop (request-changes → retry → approve)
// The gemini_code_review mock returns "request-changes" on call 1, "approve" on call 2+
// ─────────────────────────────────────────────────────────────────────────────
Deno.test({
  name: "integration: code review retry loop — request-changes → retry → approve",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    setupTestEnv();
    resetSupabaseCalls();
    const handlers = buildMockFetch();
    globalThis.fetch = createMockFetch(handlers);

    try {
      // Simpler graph: code_generation → code_review retry loop with END after
      const graph = buildTestGraph()
        .addNode("code_generation", codeGenerationAgent)
        .addNode("code_review", codeReviewAgent)
        .addEdge(START, "code_generation")
        .addConditionalEdges("code_generation", (s: any) =>
          s.status === "error" || !s.generatedDiff ? END : "code_review"
        )
        .addConditionalEdges("code_review", (s: any) =>
          s.status === "error" ? END :
          (s as any).reviewResult?.verdict === "request-changes" && (s as any).reviewRetries < 3 ? "code_generation" :
          END
        )
        .compile({ checkpointer: new MemorySaver() });

      const prepState = {
        runId: `${RUN_ID}-retry`,
        repoUrl: REPO_URL,
        githubToken: GITHUB_TOKEN,
        repoInfo: { fullName: "facebook/react", isPublic: true, defaultBranch: "main", owner: "facebook", repo: "react" },
        repoIndex: { full_name: "facebook/react", fileContents: { "src/App.tsx": "export default function App() {}" }, tree: [], fileCount: 0, totalBytes: 0, languages: ["TypeScript"] },
        repoAnalysis: {
          summary: "React library",
          conventions: { naming: "camelCase", testing: "Jest", style: "functional" },
          qualitySignals: { hasTests: true },
        },
        rankedIssues: [{
          rank: 1,
          issue: { title: "Add error boundary", description: "Add error boundary", category: "bug", severity: "high", filesAffected: ["src/App.tsx"], estimatedEffort: "1h" },
          scores: { impact: 80, difficulty: 30, acceptanceLikelihood: 90, alignmentWithGuidelines: 85 },
          overallScore: 78.5,
          rationale: "High impact",
        }],
        selectedIssueIndex: 0,
      };

      const config = { configurable: { thread_id: `${RUN_ID}-retry` } };

      // Single invoke — flows through code_gen → code_review (fails) → code_gen → code_review (passes) → END
      const finalState = await graph.invoke(prepState as any, config);
      const state = finalState as Record<string, unknown>;

      // After retry loop completes, review should have verdict "approve"
      const reviewResult = state.reviewResult as Record<string, unknown>;
      assert(reviewResult, "Review result should exist after retry loop");
      assertEquals(reviewResult.verdict, "approve", "Final review should approve after retry");

      // reviewRetries should be 1 (first fail increments by 1, second pass doesn't increment)
      assertEquals(state.reviewRetries, 1, "Should have exactly 1 retry");
      assertEquals(state.generationAttempts, 2, "Code generation should have run twice");

      // Supabase persistence
      assert(supabaseCalls.filter(c => c.table === "agent_events").length > 0, "Should have persisted agent_events");
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
      teardownTestEnv();
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7: PR agent standalone — verify it creates a pull request via GitHub API mocks
// ─────────────────────────────────────────────────────────────────────────────
Deno.test({
  name: "integration: pr agent creates pull request with pre-populated state",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    setupTestEnv();
    resetSupabaseCalls();
    const handlers = buildMockFetch();
    // Override code_review to always return approve
    handlers["gemini_code_review"] = () => jsonResponse({
      candidates: [{ content: { parts: [{ text: GEMINI_REVIEW_PASS_RESPONSE }] } }],
    });
    globalThis.fetch = createMockFetch(handlers);

    try {
      const graph = buildTestGraph()
        .addNode("code_generation", codeGenerationAgent)
        .addNode("code_review", codeReviewAgent)
        .addNode("pr_agent", prAgent)
        .addEdge(START, "code_generation")
        .addConditionalEdges("code_generation", (s: any) =>
          s.status === "error" || !s.generatedDiff ? END : "code_review"
        )
        .addConditionalEdges("code_review", (s: any) =>
          s.status === "error" ? END :
          (s as any).reviewResult?.verdict === "request-changes" && (s as any).reviewRetries < 3 ? "code_generation" :
          (s as any).reviewResult?.verdict === "approve" ? "pr_agent" : END
        )
        .addEdge("pr_agent", END)
        .compile({ checkpointer: new MemorySaver() });

      const prepState = {
        runId: `${RUN_ID}-pr`,
        repoUrl: REPO_URL,
        githubToken: GITHUB_TOKEN,
        tokenVerification: { login: "testuser", valid: true },
        repoInfo: { fullName: "facebook/react", isPublic: true, defaultBranch: "main", owner: "facebook", repo: "react" },
        repoIndex: { full_name: "facebook/react", fileContents: { "src/App.tsx": "export default function App() { return <div>Hello</div>; }" }, tree: [], fileCount: 0, totalBytes: 0, languages: ["TypeScript"] },
        repoAnalysis: {
          summary: "React library",
          conventions: { naming: "camelCase", testing: "Jest", style: "functional" },
          qualitySignals: { hasTests: true },
        },
        rankedIssues: [{
          rank: 1,
          issue: { title: "Add error boundary", description: "Add error boundary to App", category: "bug", severity: "high", filesAffected: ["src/App.tsx"], estimatedEffort: "1h", githubIssueNumber: 5 },
          scores: { impact: 80, difficulty: 30, acceptanceLikelihood: 90, alignmentWithGuidelines: 85 },
          overallScore: 78.5,
          rationale: "High impact",
        }],
        selectedIssueIndex: 0,
      };

      const config = { configurable: { thread_id: `${RUN_ID}-pr` } };

      // Single invoke: code_gen → code_review (approve) → pr_agent → END
      const finalState = await graph.invoke(prepState as any, config);
      const state = finalState as Record<string, unknown>;

      assertEquals(state.status, "completed", "PR agent should complete successfully");

      const prResult = state.prResult as Record<string, unknown>;
      assert(prResult, "PR result should exist");
      assertEquals(prResult.prUrl, "https://github.com/facebook/react/pull/42");
      assertEquals(prResult.prNumber, 42);
      assertEquals(prResult.error, null, "No error expected");
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
      teardownTestEnv();
    }
  },
});
