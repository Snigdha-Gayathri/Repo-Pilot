import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  GitBranch,
  Clock,
  ChevronDown,
  GitPullRequest,
  ListChecks,
  ThumbsUp,
  ThumbsDown,
  FileCode2,
  Star,
} from "lucide-react";
import type { AnalysisRun, AgentEvent, Issue, AgentName } from "../lib/types";
import { AGENT_META, AGENT_ORDER } from "../lib/types";
import {
  fetchRun,
  fetchEvents,
  fetchIssues,
  subscribeEvents,
  subscribeRun,
  subscribeIssues,
  resumeAnalysis,
  getGraphState,
} from "../lib/api";
import { fmtDuration, fmtTime } from "../lib/utils";
import { AgentTimeline } from "../components/AgentTimeline";
import { IssueList } from "../components/IssueList";
import { DiffViewer } from "../components/DiffViewer";

export function AnalysisView({ runId, onHome }: { runId: string; onHome: () => void }) {
  const [run, setRun] = useState<AnalysisRun | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [graphStatus, setGraphStatus] = useState<string | null>(null);
  const [rankedIssues, setRankedIssues] = useState<any[] | null>(null);
  const [generatedDiff, setGeneratedDiff] = useState<string | null>(null);
  const [checkpointBusy, setCheckpointBusy] = useState(false);

  // ── Check for checkpoint status periodically ──
  const checkCheckpoints = useMemo(() => async () => {
    try {
      const state = await getGraphState(runId);
      if (state?.status) {
        setGraphStatus(state.status);
        if (state.rankedIssues) setRankedIssues(state.rankedIssues);
        if (state.generatedDiff) setGeneratedDiff(state.generatedDiff);
      }
    } catch {
      // Graph may not have started yet
    }
  }, [runId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [r, e, i] = await Promise.all([
        fetchRun(runId),
        fetchEvents(runId),
        fetchIssues(runId),
      ]);
      if (!mounted) return;
      setRun(r);
      setEvents(e);
      setIssues(i);
      setLoading(false);
    })();

    // Initial checkpoint check
    checkCheckpoints();

    const unsubEvents = subscribeEvents(runId, setEvents);
    const unsubRun = subscribeRun(runId, setRun);
    const unsubIssues = subscribeIssues(runId, setIssues);

    // Poll run + graph state as fallback
    const poll = setInterval(async () => {
      setEvents(await fetchEvents(runId));
      setIssues(await fetchIssues(runId));
      setRun(await fetchRun(runId));
      checkCheckpoints();
    }, 2500);

    return () => {
      mounted = false;
      unsubEvents();
      unsubRun();
      unsubIssues();
      clearInterval(poll);
    };
  }, [runId, checkCheckpoints]);

  const status = run?.status ?? "pending";
  const isDone = status === "completed";
  const isAwaitingSelection = graphStatus === "awaiting_selection" || status === "awaiting_selection";
  const isAwaitingApproval = graphStatus === "awaiting_approval" || status === "awaiting_approval";

  // Per-agent rollup from events
  const agentState = useMemo(() => {
    const map: Record<string, { status: string; count: number; lastMsg: string | null; totalMs: number }> = {};
    for (const e of events) {
      const key = e.agent;
      if (!map[key]) map[key] = { status: "pending", count: 0, lastMsg: null, totalMs: 0 };
      map[key].count++;
      map[key].lastMsg = e.message;
      if (e.status === "running") map[key].status = "running";
      else if (e.status === "error") map[key].status = "error";
      else if (map[key].status !== "error" && map[key].status !== "running") map[key].status = "done";
      if (e.duration_ms) map[key].totalMs += e.duration_ms;
    }
    return map;
  }, [events]);

  const totalDuration = useMemo(
    () => events.reduce((acc, e) => acc + (e.duration_ms ?? 0), 0),
    [events],
  );

  // ── Resume handlers ──
  async function handleSelectIssue(index: number) {
    setCheckpointBusy(true);
    try {
      const state = await resumeAnalysis(runId, { selectedIndex: index });
      setGraphStatus(state.status);
      await checkCheckpoints();
    } catch (err) {
      console.error("Failed to resume:", err);
    }
    setCheckpointBusy(false);
  }

  async function handleCancelAnalysis() {
    setCheckpointBusy(true);
    try {
      await resumeAnalysis(runId, { cancelled: true });
      setGraphStatus("completed");
    } catch (err) {
      console.error("Failed to cancel:", err);
    }
    setCheckpointBusy(false);
  }

  async function handleApproveDiff(approved: boolean) {
    setCheckpointBusy(true);
    try {
      const state = await resumeAnalysis(runId, { approved });
      setGraphStatus(state.status);
      if (state.prResult?.prUrl) {
        // PR was created
        window.open(state.prResult.prUrl, "_blank");
      }
      await checkCheckpoints();
    } catch (err) {
      console.error("Failed to resume:", err);
    }
    setCheckpointBusy(false);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Top bar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <button onClick={onHome} className="btn-ghost -ml-2">
          <ArrowLeft className="h-4 w-4" />
          New analysis
        </button>
        <div className="flex items-center gap-2 text-sm">
          <StatusBadge status={isAwaitingSelection || isAwaitingApproval ? "paused" : status} />
          {totalDuration > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-ink-300">
              <Clock className="h-3.5 w-3.5" />
              {fmtDuration(totalDuration)}
            </span>
          )}
          {isDone && issues.length > 0 && (
            <button onClick={() => {}} className="btn-primary ml-1">
              <GitPullRequest className="h-4 w-4" />
              PR Created
            </button>
          )}
        </div>
      </div>

      {/* Repo header */}
      <div className="card mb-6 p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-ink-850">
            <GitBranch className="h-5 w-5 text-brand-300" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold text-white">
              {run?.repo_full_name ?? run?.repo_url ?? "Loading…"}
            </h1>
            {run?.summary?.summary && (
              <p className="mt-1 text-sm leading-relaxed text-ink-300">{run.summary.summary}</p>
            )}
            {run?.error && (
              <p className="mt-2 flex items-start gap-2 rounded-lg border border-rose2-500/30 bg-rose2-500/10 px-3 py-2 text-sm text-rose2-400">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {run.error}
              </p>
            )}
          </div>
        </div>
        {run?.summary && (
          <div className="mt-4 flex flex-wrap gap-2">
            {run.summary.frameworks?.slice(0, 6).map((f) => (
              <span key={f} className="chip border border-white/10 bg-white/[0.04] text-ink-200">
                {f}
              </span>
            ))}
            {run.summary.languages?.slice(0, 6).map((l) => (
              <span key={l} className="chip border border-white/10 bg-white/[0.04] text-ink-200">
                {l}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Checkpoint 1: Issue Selection ── */}
      {isAwaitingSelection && rankedIssues && rankedIssues.length > 0 && (
        <div className="card mb-6 border-amber2-500/30 bg-amber2-500/[0.04] p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber2-500/15 text-amber2-400">
              <ListChecks className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-white">Select an issue to work on</h2>
              <p className="text-sm text-ink-300">
                The Ranking Agent has scored the candidate issues. Pick one for the Code Generation Agent to fix.
              </p>
            </div>
          </div>
          <div className="space-y-3">
            {rankedIssues.map((ri: any, i: number) => (
              <div
                key={i}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-4 transition hover:border-brand-500/40"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 bg-ink-850 text-xs font-semibold text-ink-300">
                        {ri.rank}
                      </span>
                      <h3 className="text-sm font-semibold text-white">{ri.issue.title}</h3>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-300 line-clamp-2">
                      {ri.issue.description}
                    </p>
                    {ri.rationale && (
                      <p className="mt-1.5 text-xs italic text-ink-400">→ {ri.rationale.slice(0, 200)}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-md border border-emerald2-500/30 bg-emerald2-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald2-400">
                        Score: {Math.round(ri.overallScore)}/100
                      </span>
                      <span className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-ink-300">
                        Impact: {ri.scores.impact}
                      </span>
                      <span className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-ink-300">
                        Difficulty: {ri.scores.difficulty}
                      </span>
                      {ri.issue.estimatedEffort && (
                        <span className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-ink-300">
                          Effort: {ri.issue.estimatedEffort}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleSelectIssue(ri.rank - 1)}
                    disabled={checkpointBusy}
                    className="btn-primary shrink-0"
                  >
                    {checkpointBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        Select
                        <Star className="h-3.5 w-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-center">
            <button
              onClick={handleCancelAnalysis}
              disabled={checkpointBusy}
              className="btn-ghost text-xs text-ink-400 hover:text-ink-200"
            >
              Cancel analysis
            </button>
          </div>
        </div>
      )}

      {/* ── Checkpoint 2: Diff Approval ── */}
      {isAwaitingApproval && generatedDiff && (
        <div className="card mb-6 border-emerald2-500/30 bg-emerald2-500/[0.04] p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald2-500/15 text-emerald2-400">
              <FileCode2 className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-white">Review the generated diff</h2>
              <p className="text-sm text-ink-300">
                The Code Generation Agent produced the change below. Review it carefully —
                once you approve, it will be committed and a pull request will be opened.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-ink-950/40 p-4">
            <DiffViewer diff={generatedDiff} />
          </div>

          <p className="mt-3 flex items-start gap-2 rounded-lg border border-brand-500/20 bg-brand-500/[0.06] px-3 py-2 text-xs text-ink-300">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
            This diff was reviewed by the Code Review Agent (AI-based review — no test execution).
            After you approve, the PR Agent will fork, commit, and open a pull request automatically.
          </p>

          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              onClick={() => handleApproveDiff(false)}
              disabled={checkpointBusy}
              className="btn-ghost border-rose2-500/30 text-rose2-400 hover:bg-rose2-500/10"
            >
              <ThumbsDown className="h-4 w-4" />
              Reject
            </button>
            <button
              onClick={() => handleApproveDiff(true)}
              disabled={checkpointBusy}
              className="btn-primary"
            >
              {checkpointBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <ThumbsUp className="h-4 w-4" />
                  Approve &amp; Open PR
                </>
              )}
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* Left: agent pipeline */}
        <div className="space-y-4">
          <div className="card p-4">
            <h2 className="mb-3 px-1 text-xs font-semibold uppercase tracking-wider text-ink-400">
              Agent pipeline
            </h2>
            <div className="space-y-1">
              {AGENT_ORDER.map((name) => (
                <AgentRow
                  key={name}
                  name={name}
                  state={agentState[name]}
                  events={events.filter((e) => e.agent === name)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Right: live timeline + issues */}
        <div className="space-y-6">
          <AgentTimeline events={events} />

          {/* Show issues only when not in a checkpoint (to avoid clutter) */}
          {!isAwaitingSelection && !isAwaitingApproval && (isDone || issues.length > 0) && (
            <IssueList runId={runId} issues={issues} />
          )}

          {loading && events.length === 0 && (
            <div className="card flex items-center gap-3 p-6 text-ink-300">
              <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
              Waiting for the first agent to report…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    pending: { label: "Queued", cls: "border-ink-500/40 bg-ink-500/15 text-ink-300", icon: <Clock className="h-3.5 w-3.5" /> },
    indexing: { label: "Indexing", cls: "border-brand-500/30 bg-brand-500/15 text-brand-300", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
    analyzing: { label: "Running", cls: "border-brand-500/30 bg-brand-500/15 text-brand-300", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
    paused: { label: "Awaiting you", cls: "border-amber2-500/30 bg-amber2-500/15 text-amber2-400", icon: <ListChecks className="h-3.5 w-3.5" /> },
    awaiting_selection: { label: "Select issue", cls: "border-amber2-500/30 bg-amber2-500/15 text-amber2-400", icon: <ListChecks className="h-3.5 w-3.5" /> },
    awaiting_approval: { label: "Review diff", cls: "border-emerald2-500/30 bg-emerald2-500/15 text-emerald2-400", icon: <FileCode2 className="h-3.5 w-3.5" /> },
    generating: { label: "Generating", cls: "border-brand-500/30 bg-brand-500/15 text-brand-300", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
    completed: { label: "Completed", cls: "border-emerald2-500/30 bg-emerald2-500/15 text-emerald2-400", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
    error: { label: "Error", cls: "border-rose2-500/30 bg-rose2-500/15 text-rose2-400", icon: <AlertCircle className="h-3.5 w-3.5" /> },
  };
  const m = map[status] ?? map.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${m.cls}`}>
      {m.icon}
      {m.label}
    </span>
  );
}

function AgentRow({
  name,
  state,
  events,
}: {
  name: AgentName;
  state?: { status: string; count: number; lastMsg: string | null; totalMs: number };
  events: AgentEvent[];
}) {
  const meta = AGENT_META[name];
  const st = state?.status ?? "pending";
  const [open, setOpen] = useState(false);
  const dot =
    st === "running" ? "bg-brand-400 animate-pulse-soft"
    : st === "done" ? "bg-emerald2-500"
    : st === "error" ? "bg-rose2-500"
    : "bg-ink-600";

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-white/[0.04]"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <span className="flex-1 truncate text-sm font-medium text-ink-100">{meta.label}</span>
        {state?.totalMs ? (
          <span className="text-[11px] tabular-nums text-ink-400">{fmtDuration(state.totalMs)}</span>
        ) : null}
        {events.length > 0 && (
          <ChevronDown className={`h-3.5 w-3.5 text-ink-500 transition ${open ? "rotate-180" : ""}`} />
        )}
      </button>
      {open && events.length > 0 && (
        <div className="ml-4 space-y-1 border-l border-white/[0.06] pl-3 pb-1">
          {events.map((e) => (
            <div key={e.id} className="flex items-start gap-2 py-1 text-xs">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-ink-500" />
              <span className="flex-1 text-ink-300">{e.message}</span>
              <span className="shrink-0 tabular-nums text-ink-500">{fmtTime(e.started_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
