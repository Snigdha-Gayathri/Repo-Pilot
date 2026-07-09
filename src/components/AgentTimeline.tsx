import { useEffect, useRef } from "react";
import {
  Compass,
  Search,
  PenTool,
  Code2,
  ShieldCheck,
  Gavel,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import type { AgentEvent, AgentName } from "../lib/types";
import { AGENT_META } from "../lib/types";
import { fmtDuration, fmtTime } from "../lib/utils";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Compass,
  Search,
  PenTool,
  Code2,
  ShieldCheck,
  Gavel,
};

export function AgentTimeline({ events }: { events: AgentEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <h2 className="text-sm font-semibold text-white">Live execution</h2>
        <span className="text-xs text-ink-400">{events.length} events</span>
      </div>
      <div
        ref={scrollRef}
        className="scrollbar-thin max-h-[420px] overflow-y-auto p-3"
      >
        {events.length === 0 ? (
          <div className="flex items-center gap-2 px-2 py-6 text-sm text-ink-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Waiting for agents to start…
          </div>
        ) : (
          <ol className="relative space-y-1">
            {events.map((e, i) => (
              <TimelineRow key={e.id} event={e} isLast={i === events.length - 1} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function TimelineRow({ event, isLast }: { event: AgentEvent; isLast: boolean }) {
  const meta = AGENT_META[event.agent as AgentName] ?? AGENT_META.intake;
  const Icon = ICONS[meta.icon] ?? Compass;
  const statusIcon =
    event.status === "running" ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-400" />
    ) : event.status === "error" ? (
      <AlertCircle className="h-3.5 w-3.5 text-rose2-400" />
    ) : (
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald2-400" />
    );

  const accent =
    event.status === "running"
      ? "border-brand-400/40 bg-brand-500/10"
      : event.status === "error"
      ? "border-rose2-500/40 bg-rose2-500/10"
      : "border-white/10 bg-white/[0.03]";

  return (
    <li className="relative pl-9">
      {/* timeline rail */}
      {!isLast && (
        <span className="absolute left-[14px] top-7 bottom-0 w-px bg-white/[0.06]" />
      )}
      <span
        className={`absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border ${accent}`}
      >
        <Icon className="h-3 w-3 text-ink-200" />
      </span>
      <div className={`rounded-lg border ${accent} px-3 py-2 transition animate-fade-up`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-semibold text-ink-100">{meta.label}</span>
            {event.phase && (
              <>
                <ChevronRight className="h-3 w-3 shrink-0 text-ink-500" />
                <span className="truncate text-xs text-ink-400">{event.phase}</span>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {statusIcon}
            <span className="text-[10px] tabular-nums text-ink-500">{fmtTime(event.started_at)}</span>
            {event.duration_ms != null && (
              <span className="text-[10px] tabular-nums text-ink-500">
                {fmtDuration(event.duration_ms)}
              </span>
            )}
          </div>
        </div>
        {event.message && (
          <p className="mt-1 text-xs leading-relaxed text-ink-300">{event.message}</p>
        )}
        {event.output != null && (
          <EventOutput event={event} />
        )}
      </div>
    </li>
  );
}

function EventOutput({ event }: { event: AgentEvent }) {
  const out = event.output as Record<string, unknown> | null;
  if (!out || typeof out !== "object") return null;
  const keys = Object.keys(out);
  if (keys.length === 0) return null;

  // Render a compact summary of the output
  const summary = keys.slice(0, 3).map((k) => {
    const v = out[k];
    if (v == null) return null;
    if (typeof v === "string") return `${k}: ${v.slice(0, 120)}`;
    if (typeof v === "number" || typeof v === "boolean") return `${k}: ${String(v)}`;
    if (Array.isArray(v)) return `${k}: [${v.length} item${v.length === 1 ? "" : "s"}]`;
    return `${k}: {…}`;
  }).filter(Boolean);

  if (summary.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-0.5 rounded-md bg-ink-950/50 px-2.5 py-1.5 font-mono text-[11px] text-ink-400">
      {summary.map((s, i) => (
        <div key={i} className="truncate">{s}</div>
      ))}
    </div>
  );
}
