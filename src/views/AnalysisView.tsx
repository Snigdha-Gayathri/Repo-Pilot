import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  GitBranch,
  Clock,
  ChevronDown,
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
} from "../lib/api";
import { fmtDuration, fmtTime } from "../lib/utils";
import { AgentTimeline } from "../components/AgentTimeline";
import { IssueList } from "../components/IssueList";
import { PrModal } from "../components/PrModal";
import { GitPullRequest } from "lucide-react";

export function AnalysisView({ runId, onHome }: { runId: string; onHome: () => void }) {
  const [run, setRun] = useState<AnalysisRun | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPr, setShowPr] = useState(false);

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

    const unsubEvents = subscribeEvents(runId, setEvents);
    const unsubRun = subscribeRun(runId, setRun);
    const unsubIssues = subscribeIssues(runId, setIssues);

    // also poll as a realtime fallback
    const poll = setInterval(async () => {
      setEvents(await fetchEvents(runId));
      setIssues(await fetchIssues(runId));
      setRun(await fetchRun(runId));
    }, 2500);

    return () => {
      mounted = false;
      unsubEvents();
      unsubRun();
      unsubIssues();
      clearInterval(poll);
    };
  }, [runId]);

  const status = run?.status ?? "pending";
  const isDone = status === "completed";

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
    [events]
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Top bar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <button onClick={onHome} className="btn-ghost -ml-2">
          <ArrowLeft className="h-4 w-4" />
          New analysis
        </button>
        <div className="flex items-center gap-2 text-sm">
          <StatusBadge status={status} />
          {totalDuration > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-ink-300">
              <Clock className="h-3.5 w-3.5" />
              {fmtDuration(totalDuration)}
            </span>
          )}
          {isDone && issues.length > 0 && (
            <button onClick={() => setShowPr(true)} className="btn-primary ml-1">
              <GitPullRequest className="h-4 w-4" />
              Create Pull Request
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
          {(isDone || issues.length > 0) && (
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

      {showPr && (
        <PrModal runId={runId} issues={issues} onClose={() => setShowPr(false)} />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    pending: { label: "Queued", cls: "border-ink-500/40 bg-ink-500/15 text-ink-300", icon: <Clock className="h-3.5 w-3.5" /> },
    analyzing: { label: "Running", cls: "border-brand-500/30 bg-brand-500/15 text-brand-300", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
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
    st === "running" ? "bg-brand-400 animate-pulse-soft" :
    st === "done" ? "bg-emerald2-500" :
    st === "error" ? "bg-rose2-500" : "bg-ink-600";

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
