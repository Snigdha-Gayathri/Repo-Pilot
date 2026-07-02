// Shared domain types for RepoPilot AI.

export type AgentName =
  | "repository_analyst"
  | "issue_hunter"
  | "solution_architect"
  | "code_engineer"
  | "qa_agent"
  | "reviewer";

export const AGENT_META: Record<
  AgentName,
  { label: string; short: string; color: string; icon: string }
> = {
  repository_analyst: { label: "Repository Analyst", short: "Analyst", color: "brand", icon: "Compass" },
  issue_hunter: { label: "Issue Hunter", short: "Hunter", color: "amber", icon: "Search" },
  solution_architect: { label: "Solution Architect", short: "Architect", color: "emerald", icon: "PenTool" },
  code_engineer: { label: "Code Engineer", short: "Engineer", color: "brand", icon: "Code2" },
  qa_agent: { label: "QA Agent", short: "QA", color: "amber", icon: "ShieldCheck" },
  reviewer: { label: "Reviewer", short: "Reviewer", color: "emerald", icon: "Gavel" },
};

export const AGENT_ORDER: AgentName[] = [
  "repository_analyst",
  "issue_hunter",
  "solution_architect",
  "code_engineer",
  "qa_agent",
  "reviewer",
];

export interface AnalysisRun {
  id: string;
  repo_url: string;
  repo_full_name: string | null;
  default_branch: string | null;
  status: "pending" | "analyzing" | "completed" | "error";
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
