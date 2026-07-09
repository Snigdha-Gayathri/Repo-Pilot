// ---------------------------------------------------------------------------
// LangGraph shared state schema — Annotation.Root
// Every node reads/writes this TypedDict-shaped state.
// ---------------------------------------------------------------------------
import { Annotation } from "npm:@langchain/langgraph";
import type {
  RepoIndex,
  RepoMetadata,
  RepoAnalysis,
  DiscoveredIssue,
  RankedIssue,
  GeneratedDiff,
  CodeReviewResult,
  PrResult,
  TokenVerification,
  GraphStatus,
} from "./types.ts";

/** Reducer: merge arrays by concatenation (append mode). */
function concatReducer<T>(a: T[], b: T[]): T[] {
  return a.concat(b);
}

// ---------------------------------------------------------------------------
// Graph state definition
// ---------------------------------------------------------------------------
/** Simple override reducer: new value always wins. */
function overrideReducer<T>(a: T, b: T): T {
  return b;
}

export const RepoPilotState = Annotation.Root({
  // ── Run metadata ──
  runId: Annotation<string>(),
  repoUrl: Annotation<string>(),
  status: Annotation<GraphStatus>({
    default: () => "pending" as GraphStatus,
    reducer: overrideReducer,
  }),
  error: Annotation<string | null>({
    default: () => null,
    reducer: overrideReducer,
  }),

  // ── GitHub credentials (PAT, verified by Intake Agent) ──
  githubToken: Annotation<string | null>({
    default: () => null,
    reducer: overrideReducer,
  }),
  tokenVerification: Annotation<TokenVerification | null>({
    default: () => null,
    reducer: overrideReducer,
  }),

  // ── Intake Agent output ──
  repoInfo: Annotation<RepoMetadata | null>({
    default: () => null,
    reducer: overrideReducer,
  }),

  // ── Repo Analysis Agent output ──
  repoIndex: Annotation<RepoIndex | null>({
    default: () => null,
    reducer: overrideReducer,
  }),
  repoAnalysis: Annotation<RepoAnalysis | null>({
    default: () => null,
    reducer: overrideReducer,
  }),

  // ── Issue Discovery Agent output ──
  discoveredIssues: Annotation<DiscoveredIssue[]>({
    default: () => [],
    reducer: concatReducer,
  }),

  // ── Ranking Agent output ──
  rankedIssues: Annotation<RankedIssue[] | null>({
    default: () => null,
    reducer: overrideReducer,
  }),

  // ── Human checkpoint 1 — issue selection ──
  selectedIssueIndex: Annotation<number | null>({
    default: () => null,
    reducer: overrideReducer,
  }),
  userCancelled: Annotation<boolean>({
    default: () => false,
    reducer: overrideReducer,
  }),

  // ── Code Generation Agent output (with retry loop) ──
  generatedDiff: Annotation<string | null>({
    default: () => null,
    reducer: overrideReducer,
  }),
  generationAttempts: Annotation<number>({
    default: () => 0,
    reducer: overrideReducer,
  }),

  // ── Code Review Agent output ──
  reviewResult: Annotation<CodeReviewResult | null>({
    default: () => null,
    reducer: overrideReducer,
  }),
  reviewRetries: Annotation<number>({
    default: () => 0,
    reducer: overrideReducer,
  }),

  // ── Human checkpoint 2 — diff approval ──
  diffApproved: Annotation<boolean | null>({
    default: () => null,
    reducer: overrideReducer,
  }),

  // ── PR Agent output ──
  prResult: Annotation<PrResult | null>({
    default: () => null,
    reducer: overrideReducer,
  }),
});

export type RepoPilotStateType = typeof RepoPilotState.State;
