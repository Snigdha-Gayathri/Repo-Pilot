import { supabase, EDGE_URL } from "./supabase";
import type { AnalysisRun, AgentEvent, Issue, Proposal, GraphState, ResumeCommand } from "./types";

const headers = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
});

/** Kick off a new analysis run. Progress is streamed via realtime. */
export async function startAnalysis(repoUrl: string): Promise<string> {
  const { data, error } = await supabase
    .from("analysis_runs")
    .insert({ repo_url: repoUrl, status: "pending" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const runId = data.id;

  const res = await fetch(`${EDGE_URL}?action=analyze`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ repo_url: repoUrl, run_id: runId }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Failed to start analysis: ${txt}`);
  }
  return runId;
}

/**
 * Resume a paused graph execution after a human-in-the-loop checkpoint.
 * This is called when the user selects an issue or approves a diff.
 */
export async function resumeAnalysis(
  runId: string,
  command: ResumeCommand,
): Promise<GraphState> {
  const res = await fetch(`${EDGE_URL}?action=resume`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ run_id: runId, command }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Failed to resume: ${txt}`);
  }
  const data = await res.json();
  return data as GraphState;
}

/**
 * Check the current graph state (useful after reloading the page).
 */
export async function getGraphState(runId: string): Promise<GraphState> {
  const res = await fetch(`${EDGE_URL}?action=status&run_id=${runId}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error("Failed to get graph state");
  const data = await res.json();
  return data as GraphState;
}

export async function fetchRun(runId: string): Promise<AnalysisRun | null> {
  const { data } = await supabase
    .from("analysis_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  return data as AnalysisRun | null;
}

export async function fetchEvents(runId: string): Promise<AgentEvent[]> {
  const { data } = await supabase
    .from("agent_events")
    .select("*")
    .eq("run_id", runId)
    .order("started_at", { ascending: true });
  return (data ?? []) as AgentEvent[];
}

export async function fetchIssues(runId: string): Promise<Issue[]> {
  const { data } = await supabase
    .from("issues")
    .select("*")
    .eq("run_id", runId)
    .order("created_at", { ascending: true });
  return (data ?? []) as Issue[];
}

export async function fetchProposals(runId: string): Promise<Proposal[]> {
  const { data } = await supabase
    .from("proposals")
    .select("*")
    .eq("run_id", runId)
    .order("created_at", { ascending: true });
  return (data ?? []) as Proposal[];
}

/** Subscribe to live inserts/updates on agent_events for a run. */
export function subscribeEvents(
  runId: string,
  onChange: (events: AgentEvent[]) => void,
): () => void {
  let latest: AgentEvent[] = [];
  const channel = supabase
    .channel(`events-${runId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "agent_events", filter: `run_id=eq.${runId}` },
      async () => {
        latest = await fetchEvents(runId);
        onChange(latest);
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "issues", filter: `run_id=eq.${runId}` },
      async () => {
        latest = await fetchEvents(runId);
        onChange(latest);
      },
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeRun(
  runId: string,
  onChange: (run: AnalysisRun | null) => void,
): () => void {
  const channel = supabase
    .channel(`run-${runId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "analysis_runs", filter: `id=eq.${runId}` },
      async () => {
        onChange(await fetchRun(runId));
      },
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeIssues(
  runId: string,
  onChange: (issues: Issue[]) => void,
): () => void {
  const channel = supabase
    .channel(`issues-${runId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "issues", filter: `run_id=eq.${runId}` },
      async () => {
        onChange(await fetchIssues(runId));
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "proposals", filter: `run_id=eq.${runId}` },
      async () => {
        onChange(await fetchIssues(runId));
      },
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/** Start the GitHub OAuth flow — kept for backward compatibility but PAT is now the primary method. */
export async function startGithubOAuth(redirectUri: string): Promise<string> {
  const res = await fetch(
    `${EDGE_URL}?action=github_oauth_start&redirect_uri=${encodeURIComponent(redirectUri)}`,
    { headers: headers() },
  );
  if (!res.ok) throw new Error("GitHub OAuth not configured");
  const data = await res.json();
  return data.auth_url as string;
}

/** Exchange the OAuth code and create the PR with approved files. */
export async function completeGithubOAuth(
  code: string,
  runId: string,
  approvedFiles: { path: string; content: string }[],
): Promise<{ pr_url?: string; error?: string; user?: { login: string } }> {
  const res = await fetch(`${EDGE_URL}?action=github_oauth_callback`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ code, run_id: runId, approved_files: approvedFiles }),
  });
  const data = await res.json();
  return data;
}
