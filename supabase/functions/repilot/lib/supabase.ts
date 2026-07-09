// ---------------------------------------------------------------------------
// Supabase persistence helpers — adapted from existing code.
// Used to stream live progress to the frontend via agent_events table.
// ---------------------------------------------------------------------------
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import type { AgentName } from "../types.ts";

let _supa: ReturnType<typeof createClient> | null = null;

export function getSupabase() {
  if (!_supa) {
    const supaUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    _supa = createClient(supaUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _supa;
}

/**
 * Insert a running event and return its id.
 */
export async function startEvent(
  runId: string,
  agent: AgentName,
  phase: string,
  message: string,
): Promise<string> {
  const supa = getSupabase();
  const { data, error } = await (supa as any)
    .from("agent_events")
    .insert({ run_id: runId, agent, phase, status: "running", message })
    .select("id")
    .single();
  if (error) throw new Error(`startEvent: ${error.message}`);
  return data.id;
}

/**
 * Mark an event as done/error with output.
 */
export async function finishEvent(
  eventId: string,
  status: string,
  output: unknown,
  startedAt: string,
) {
  const supa = getSupabase();
  const endedAt = new Date().toISOString();
  const duration = Date.parse(endedAt) - Date.parse(startedAt);
  const { error } = await (supa as any)
    .from("agent_events")
    .update({ status, output, ended_at: endedAt, duration_ms: duration })
    .eq("id", eventId);
  if (error) console.error("finishEvent error:", error.message);
}

/**
 * Update a field on the analysis_runs row.
 */
export async function updateRun(
  runId: string,
  patch: Record<string, unknown>,
) {
  const supa = getSupabase();
  const { error } = await (supa as any).from("analysis_runs").update(patch).eq("id", runId);
  if (error) console.error("updateRun error:", error.message);
}

/**
 * Get the run row.
 */
export async function getRun(runId: string) {
  const supa = getSupabase();
  const { data, error } = await (supa as any)
    .from("analysis_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new Error(`getRun: ${error.message}`);
  return data;
}

/**
 * Insert issues found by the Issue Discovery Agent.
 */
export async function insertIssues(
  runId: string,
  issues: { title: string; description: string; category: string; severity: string; confidence: number; files_affected: string[]; estimated_effort: string; is_important: boolean }[],
): Promise<{ id: string; title: string }[]> {
  const supa = getSupabase();
  const rows = issues.map((i) => ({
    run_id: runId,
    title: i.title,
    description: i.description,
    category: i.category,
    severity: i.severity,
    confidence: i.confidence,
    files_affected: i.files_affected,
    estimated_effort: i.estimated_effort,
    suggested_solutions: [],
    is_important: i.is_important,
  }));
  const { data, error } = await (supa as any).from("issues").insert(rows).select("id, title");
  if (error) throw new Error(`insertIssues: ${error.message}`);
  return data ?? [];
}

/**
 * Insert a proposal row.
 */
export async function insertProposal(
  runId: string,
  issueId: string,
  approach: string,
  diff: string,
  files: string[],
  reviewResult: any,
  complexity: string,
  risk: string,
) {
  const supa = getSupabase();
  const { data, error } = await (supa as any)
    .from("proposals")
    .insert({
      run_id: runId,
      issue_id: issueId,
      approach,
      tradeoffs: [],
      complexity,
      risk,
      confidence: reviewResult?.score ? reviewResult.score / 100 : 0.7,
      diff,
      files,
      tests: reviewResult?.testCode ?? "",
      qa_notes: reviewResult ?? null,
      is_selected: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(`insertProposal: ${error.message}`);
  return data.id;
}

/**
 * Record the PR request.
 */
export async function insertPrRequest(
  runId: string,
  githubLogin: string,
  forkUrl: string | null,
  branchName: string | null,
  prUrl: string | null,
  prNumber: number | null,
  status: string,
  error: string | null,
  approvedFiles: { path: string; content: string }[],
) {
  const supa = getSupabase();
  const { error: err } = await (supa as any).from("pr_requests").insert({
    run_id: runId,
    github_login: githubLogin,
    fork_url: forkUrl,
    branch_name: branchName,
    pr_url: prUrl,
    pr_number: prNumber,
    status,
    error,
    approved_files: approvedFiles,
  });
  if (err) console.error("insertPrRequest error:", err.message);
}
