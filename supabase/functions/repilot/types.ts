// ---------------------------------------------------------------------------
// Shared domain types for RepoPilot AI + LangGraph multi-agent system
// ---------------------------------------------------------------------------

/** Claim-scope names we verify on the PAT. */
export const REQUIRED_PAT_SCOPES = ["repo", "workflow"];

/** Agent names used in the new LangGraph pipeline. */
export type AgentName =
  | "intake"
  | "repo_analysis"
  | "issue_discovery"
  | "ranking"
  | "human_checkpoint"
  | "code_generation"
  | "code_review"
  | "pr_agent";

export const AGENT_LABELS: Record<AgentName, string> = {
  intake: "Intake Agent",
  repo_analysis: "Repo Analysis Agent",
  issue_discovery: "Issue Discovery Agent",
  ranking: "Ranking Agent",
  human_checkpoint: "Human Checkpoint",
  code_generation: "Code Generation Agent",
  code_review: "Code Review Agent",
  pr_agent: "Pull Request Agent",
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

// ---------------------------------------------------------------------------
// RepoIndex — same structure as the existing code
// ---------------------------------------------------------------------------
export interface RepoIndex {
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
// Repo metadata from Intake Agent
// ---------------------------------------------------------------------------
export interface RepoMetadata {
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
  description: string;
  isPublic: boolean;
  language: string;
  topics: string[];
  stars: number;
  openIssuesCount: number;
  hasContributing: boolean;
  hasCodeOfConduct: boolean;
  license: string | null;
}

// ---------------------------------------------------------------------------
// Repo analysis from Repo Analysis Agent
// ---------------------------------------------------------------------------
export interface RepoAnalysis {
  summary: string;
  architecture: string;
  frameworks: string[];
  dependencies: string[];
  languages: string[];
  conventions: {
    naming: string;
    structure: string;
    testing: string;
    style: string;
  };
  entryPoints: string[];
  techStack: string[];
  qualitySignals: {
    hasTests: boolean;
    testFramework: string | null;
    hasCi: boolean;
    hasLintConfig: boolean;
    readmeQuality: "none" | "minimal" | "good" | "excellent";
  };
}

// ---------------------------------------------------------------------------
// Issue Discovery Agent outputs
// ---------------------------------------------------------------------------
export interface DiscoveredIssue {
  title: string;
  description: string;
  category: "bug" | "todo" | "smell" | "duplication" | "docs" | "tests" | "performance" | "security" | "beginner";
  severity: "critical" | "high" | "medium" | "low";
  confidence: number;
  filesAffected: string[];
  estimatedEffort: string;
  isImportant: boolean;
  source: "github_issue" | "static_analysis";
  githubIssueUrl?: string;
  githubIssueNumber?: number;
}

// ---------------------------------------------------------------------------
// Ranking Agent outputs
// ---------------------------------------------------------------------------
export interface RankedIssue {
  issue: DiscoveredIssue;
  rank: number;
  scores: {
    impact: number;         // 0-100
    difficulty: number;     // 0-100 (lower = easier)
    acceptanceLikelihood: number; // 0-100
    alignmentWithGuidelines: number; // 0-100
  };
  overallScore: number;    // weighted composite
  rationale: string;
}

// ---------------------------------------------------------------------------
// Code Generation outputs
// ---------------------------------------------------------------------------
export interface GeneratedDiff {
  approach: string;
  diff: string;      // unified diff string
  files: string[];   // paths touched
  notes: string;
}

// ---------------------------------------------------------------------------
// Code Review Agent outputs
// ---------------------------------------------------------------------------
export interface CodeReviewResult {
  verdict: "approve" | "request-changes";
  feedback: string | null;
  regressions: string[];
  testCode: string;
  testFile: string | null;
  score: number; // 0-100
}

// ---------------------------------------------------------------------------
// PR Agent outputs
// ---------------------------------------------------------------------------
export interface PrResult {
  prUrl: string | null;
  prNumber: number | null;
  branchName: string | null;
  forkUrl: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// GitHub token verification result
// ---------------------------------------------------------------------------
export interface TokenVerification {
  valid: boolean;
  login: string | null;
  scopes: string[];
  missingScopes: string[];
  hasRepoScope: boolean;
  hasWorkflowScope: boolean;
  hasForkRights: boolean | null; // null = not checked yet
  rateLimitRemaining: number;
  rateLimitReset: number;
}

// ---------------------------------------------------------------------------
// Graph status enum
// ---------------------------------------------------------------------------
export type GraphStatus =
  | "pending"
  | "indexing"
  | "analyzing"
  | "awaiting_selection"
  | "generating"
  | "awaiting_approval"
  | "completed"
  | "error";
