// Shared domain types for RepoPilot AI + LangGraph multi-agent system.
// Matches the backend types in supabase/functions/repilot/types.ts

export type AgentName =
  | "intake"
  | "repo_analysis"
  | "issue_discovery"
  | "ranking"
  | "human_checkpoint"
  | "code_generation"
  | "code_review"
  | "pr_agent";

export const AGENT_META: Record<
  AgentName,
  { label: string; short: string; color: string; icon: string; description: string }
> = {
  intake: {
    label: "Intake Agent",
    short: "Intake",
    color: "brand",
    icon: "Compass",
    description: "Validates URL, checks GitHub token scopes, fetches repo metadata",
  },
  repo_analysis: {
    label: "Repo Analysis",
    short: "Analysis",
    color: "brand",
    icon: "Search",
    description: "Clones/indexes repo, builds structural map, analyzes conventions",
  },
  issue_discovery: {
    label: "Issue Discovery",
    short: "Issues",
    color: "amber",
    icon: "Bug",
    description: "Finds bugs, TODOs, labeled GitHub issues, code smells, security risks",
  },
  ranking: {
    label: "Ranking Agent",
    short: "Ranking",
    color: "emerald",
    icon: "Gavel",
    description: "Scores issues by impact, difficulty, and acceptance likelihood",
  },
  human_checkpoint: {
    label: "Human Checkpoint",
    short: "You",
    color: "amber",
    icon: "Eye",
    description: "Pauses for your input — select an issue, review & approve the diff",
  },
  code_generation: {
    label: "Code Generation",
    short: "Engineer",
    color: "brand",
    icon: "Code2",
    description: "Writes the fix as a unified diff following repo conventions",
  },
  code_review: {
    label: "Code Review",
    short: "Review",
    color: "emerald",
    icon: "ShieldCheck",
    description: "AI-powered review of correctness & style. Does NOT execute tests.",
  },
  pr_agent: {
    label: "Pull Request",
    short: "PR",
    color: "brand",
    icon: "GitPullRequest",
    description: "Forks repo (or uses existing fork), branches, commits, opens PR",
  },
};

export const AGENT_ORDER: AgentName[] = [
  "intake",
  "repo_analysis",
  "issue_discovery",
  "ranking",
  "human_checkpoint",
  "code_generation",
  "code_review",
  "pr_agent",
];

export interface AnalysisRun {
  id: string;
  repo_url: string;
  repo_full_name: string | null;
  default_branch: string | null;
  status: "pending" | "indexing" | "analyzing" | "awaiting_selection" | "generating" | "awaiting_approval" | "completed" | "error";
  summary: RepoSummary | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface RepoSummary {
  summary?: string;
  architecture?: string;
  frameworks?: string[];
  dependencies?: string[];
  languages?: string[];
  conventions?: {
    naming?: string;
    structure?: string;
    testing?: string;
    style?: string;
  };
  entryPoints?: string[];
  techStack?: string[];
  qualitySignals?: {
    hasTests: boolean;
    testFramework: string | null;
    hasCi: boolean;
    hasLintConfig: boolean;
    readmeQuality: "none" | "minimal" | "good" | "excellent";
  };
}

export interface AgentEvent {
  id: string;
  run_id: string;
  agent: AgentName;
  phase: string | null;
  status: "running" | "done" | "error";
  message: string | null;
  output: unknown;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
}

export interface Issue {
  id: string;
  run_id: string;
  title: string;
  description: string;
  category: string | null;
  severity: "critical" | "high" | "medium" | "low" | string | null;
  confidence: number | null;
  files_affected: string[];
  estimated_effort: string | null;
  suggested_solutions: SolutionStrategy[];
  reviewer_recommendation: ReviewerRecommendation | null;
  is_important: boolean;
  selected_proposal_id: string | null;
  created_at: string;
}

export interface SolutionStrategy {
  approach?: string;
  description?: string;
  tradeoffs?: string[];
  complexity?: string;
  risk?: string;
  confidence?: number;
}

export interface ReviewerRecommendation {
  summary?: string;
  confidence?: number;
  conditions?: string[];
  selectedIndex?: number;
  scores?: { index: number; score: number; rationale: string }[];
}

export interface Proposal {
  id: string;
  issue_id: string;
  run_id: string;
  approach: string;
  tradeoffs: string[];
  complexity: string | null;
  risk: string | null;
  confidence: number | null;
  diff: string;
  files: string[];
  tests: string;
  qa_notes: QaNotes | null;
  reviewer_score: number | null;
  reviewer_notes: string | null;
  is_selected: boolean;
  created_at: string;
}

export interface QaNotes {
  regressions?: string[];
  testStrategy?: string;
  testFile?: string;
  verdict?: string;
  notes?: string;
}

export interface PrRequest {
  id: string;
  run_id: string;
  github_login: string | null;
  fork_url: string | null;
  branch_name: string | null;
  pr_url: string | null;
  pr_number: number | null;
  status: string;
  error: string | null;
  approved_files: { path: string; content: string }[];
}

// ── New types for checkpoint/resume flow ──

export interface GraphState {
  runId: string;
  repoUrl: string;
  status: string;
  error: string | null;
  rankedIssues?: RankedIssue[];
  generatedDiff?: string | null;
  diffApproved?: boolean | null;
  prResult?: { prUrl: string | null; error: string | null } | null;
}

export interface RankedIssue {
  rank: number;
  issue: {
    title: string;
    description: string;
    category: string;
    severity: string;
    confidence: number;
    filesAffected: string[];
    estimatedEffort: string;
    isImportant: boolean;
    githubIssueUrl?: string;
  };
  scores: {
    impact: number;
    difficulty: number;
    acceptanceLikelihood: number;
    alignmentWithGuidelines: number;
  };
  overallScore: number;
  rationale: string;
}

export interface ResumeCommand {
  selectedIndex?: number;
  approved?: boolean;
  cancelled?: boolean;
}

export type Severity = "critical" | "high" | "medium" | "low";

export const SEVERITY_META: Record<string, { label: string; cls: string; dot: string }> = {
  critical: { label: "Critical", cls: "bg-rose2-500/15 text-rose2-400 border-rose2-500/30", dot: "bg-rose2-500" },
  high: { label: "High", cls: "bg-amber2-500/15 text-amber2-400 border-amber2-500/30", dot: "bg-amber2-500" },
  medium: { label: "Medium", cls: "bg-brand-500/15 text-brand-300 border-brand-500/30", dot: "bg-brand-400" },
  low: { label: "Low", cls: "bg-ink-500/20 text-ink-300 border-ink-500/40", dot: "bg-ink-400" },
};

export const CATEGORY_META: Record<string, { label: string; icon: string }> = {
  bug: { label: "Bug", icon: "Bug" },
  todo: { label: "TODO", icon: "ListTodo" },
  smell: { label: "Code Smell", icon: "Wind" },
  duplication: { label: "Duplication", icon: "Copy" },
  docs: { label: "Docs", icon: "FileText" },
  tests: { label: "Tests", icon: "FlaskConical" },
  performance: { label: "Performance", icon: "Gauge" },
  security: { label: "Security", icon: "ShieldAlert" },
  beginner: { label: "Beginner-friendly", icon: "Sparkles" },
};
