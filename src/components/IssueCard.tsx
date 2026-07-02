import { useEffect, useState } from "react";
import {
  ChevronDown,
  Bug,
  ListTodo,
  Wind,
  Copy,
  FileText,
  FlaskConical,
  Gauge,
  ShieldAlert,
  Sparkles,
  Clock,
  FileCode2,
  Gavel,
  Lightbulb,
  CheckCircle2,
  Star,
} from "lucide-react";
import type { Issue, Proposal } from "../lib/types";
import { SEVERITY_META, CATEGORY_META } from "../lib/types";
import { fetchProposals } from "../lib/api";
import { DiffViewer } from "./DiffViewer";

const CAT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Bug,
  ListTodo,
  Wind,
  Copy,
  FileText,
  FlaskConical,
  Gauge,
  ShieldAlert,
  Sparkles,
};

export function IssueCard({
  runId,
  issue,
  index,
  open,
  onToggle,
}: {
  runId: string;
  issue: Issue;
  index: number;
  open: boolean;
  onToggle: () => void;
}) {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [loadingProposals, setLoadingProposals] = useState(false);

  useEffect(() => {
    if (!open || proposals) return;
    setLoadingProposals(true);
    fetchProposals(runId).then((p) => {
      setProposals(p.filter((x) => x.issue_id === issue.id));
      setLoadingProposals(false);
    });
  }, [open, proposals, runId, issue.id]);

  const sev = SEVERITY_META[issue.severity ?? "low"] ?? SEVERITY_META.low;
  const cat = CATEGORY_META[issue.category ?? ""] ?? { label: issue.category ?? "Issue", icon: "Sparkles" };
  const CatIcon = CAT_ICONS[cat.icon] ?? Sparkles;
  const confidence = issue.confidence != null ? Math.round(issue.confidence * 100) : null;

  return (
    <div className="card overflow-hidden transition">
      {/* Header (clickable) */}
      <button onClick={onToggle} className="flex w-full items-start gap-3 p-4 text-left transition hover:bg-white/[0.02]">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 bg-ink-850 text-xs font-semibold text-ink-300">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-white">{issue.title}</h3>
            {issue.is_important && (
              <span className="chip border-amber2-500/30 bg-amber2-500/10 text-amber2-400">
                <Star className="h-3 w-3" /> Important
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`chip border ${sev.cls}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${sev.dot}`} />
              {sev.label}
            </span>
            <span className="chip border border-white/10 bg-white/[0.04] text-ink-200">
              <CatIcon className="h-3 w-3" />
              {cat.label}
            </span>
            {confidence != null && (
              <span className="chip border border-white/10 bg-white/[0.04] text-ink-300">
                <CheckCircle2 className="h-3 w-3 text-emerald2-400" />
                {confidence}% confidence
              </span>
            )}
            {issue.estimated_effort && (
              <span className="chip border border-white/10 bg-white/[0.04] text-ink-300">
                <Clock className="h-3 w-3" />
                {issue.estimated_effort}
              </span>
            )}
            <span className="chip border border-white/10 bg-white/[0.04] text-ink-300">
              <FileCode2 className="h-3 w-3" />
              {issue.files_affected.length} file{issue.files_affected.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <ChevronDown className={`mt-1 h-5 w-5 shrink-0 text-ink-400 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Body */}
      {open && (
        <div className="border-t border-white/[0.06] p-4 pt-4 animate-fade-up">
          {/* Description */}
          <Section title="Description" icon={<FileText className="h-4 w-4" />}>
            <p className="text-sm leading-relaxed text-ink-200">{issue.description}</p>
          </Section>

          {/* Files affected */}
          {issue.files_affected.length > 0 && (
            <Section title="Files affected" icon={<FileCode2 className="h-4 w-4" />}>
              <div className="flex flex-wrap gap-1.5">
                {issue.files_affected.map((f) => (
                  <code
                    key={f}
                    className="rounded-md border border-white/10 bg-ink-950/60 px-2 py-1 font-mono text-xs text-ink-200"
                  >
                    {f}
                  </code>
                ))}
              </div>
            </Section>
          )}

          {/* Suggested solutions */}
          {issue.suggested_solutions && issue.suggested_solutions.length > 0 && (
            <Section title="Suggested solutions" icon={<Lightbulb className="h-4 w-4" />}>
              <div className="space-y-2">
                {issue.suggested_solutions.map((s, i) => (
                  <div key={i} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink-100">{s.approach ?? `Strategy ${i + 1}`}</span>
                      <div className="flex gap-1.5">
                        {s.complexity && <Pill label={`complexity: ${s.complexity}`} />}
                        {s.risk && <Pill label={`risk: ${s.risk}`} />}
                        {s.confidence != null && (
                          <Pill label={`${Math.round(s.confidence * 100)}% conf`} accent />
                        )}
                      </div>
                    </div>
                    {s.description && (
                      <p className="mt-1.5 text-xs leading-relaxed text-ink-300">{s.description}</p>
                    )}
                    {s.tradeoffs && s.tradeoffs.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {s.tradeoffs.map((t, j) => (
                          <li key={j} className="flex gap-1.5 text-xs text-ink-400">
                            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-ink-500" />
                            {t}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Reviewer recommendation */}
          {issue.reviewer_recommendation && (
            <Section title="Reviewer's recommendation" icon={<Gavel className="h-4 w-4" />}>
              <div className="rounded-lg border border-emerald2-500/20 bg-emerald2-500/[0.06] p-3">
                <p className="text-sm leading-relaxed text-ink-100">
                  {issue.reviewer_recommendation.summary ?? "Reviewer selected the best implementation."}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {issue.reviewer_recommendation.confidence != null && (
                    <Pill label={`${Math.round(issue.reviewer_recommendation.confidence * 100)}% confidence`} accent />
                  )}
                  {issue.reviewer_recommendation.conditions?.map((c, i) => (
                    <Pill key={i} label={c} />
                  ))}
                </div>
                {issue.reviewer_recommendation.scores && issue.reviewer_recommendation.scores.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {issue.reviewer_recommendation.scores.map((sc) => (
                      <div key={sc.index} className="flex items-center gap-2 text-xs">
                        <span className="grid h-6 w-6 place-items-center rounded bg-white/[0.06] font-mono text-ink-300">
                          {sc.index + 1}
                        </span>
                        <span className="font-semibold text-emerald2-400">{sc.score}/100</span>
                        <span className="text-ink-400">{sc.rationale}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Proposals / diffs */}
          <Section title="Implementation & diffs" icon={<FileCode2 className="h-4 w-4" />}>
            {loadingProposals ? (
              <div className="flex items-center gap-2 py-4 text-sm text-ink-400">
                <span className="h-4 w-4 animate-spin-slow rounded-full border-2 border-white/20 border-t-brand-400" />
                Generating proposals…
              </div>
            ) : proposals && proposals.length > 0 ? (
              <div className="space-y-4">
                {proposals.map((p, i) => (
                  <ProposalBlock key={p.id} proposal={p} index={i} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-400">No proposals generated yet.</p>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function ProposalBlock({ proposal, index }: { proposal: Proposal; index: number }) {
  const [showTests, setShowTests] = useState(false);
  return (
    <div
      className={`rounded-lg border p-3 transition ${
        proposal.is_selected
          ? "border-emerald2-500/30 bg-emerald2-500/[0.04]"
          : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded bg-white/[0.06] font-mono text-xs text-ink-300">
            {index + 1}
          </span>
          <span className="text-sm font-medium text-ink-100">{proposal.approach}</span>
          {proposal.is_selected && (
            <span className="chip border-emerald2-500/30 bg-emerald2-500/15 text-emerald2-400">
              <CheckCircle2 className="h-3 w-3" /> Selected
            </span>
          )}
        </div>
        <div className="flex gap-1.5">
          {proposal.reviewer_score != null && (
            <Pill label={`score ${proposal.reviewer_score}/100`} accent />
          )}
          {proposal.complexity && <Pill label={proposal.complexity} />}
          {proposal.risk && <Pill label={`risk: ${proposal.risk}`} />}
        </div>
      </div>

      {proposal.reviewer_notes && (
        <p className="mt-2 text-xs leading-relaxed text-ink-400">{proposal.reviewer_notes}</p>
      )}

      {proposal.diff && (
        <div className="mt-3">
          <DiffViewer diff={proposal.diff} />
        </div>
      )}

      {proposal.qa_notes && (
        <div className="mt-3 rounded-lg border border-white/10 bg-ink-950/40 p-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-3.5 w-3.5 text-amber2-400" />
            <span className="text-xs font-semibold text-ink-200">QA verdict: {proposal.qa_notes.verdict ?? "—"}</span>
          </div>
          {proposal.qa_notes.notes && (
            <p className="mt-1 text-xs text-ink-400">{proposal.qa_notes.notes}</p>
          )}
          {proposal.qa_notes.regressions && proposal.qa_notes.regressions.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {proposal.qa_notes.regressions.map((r, i) => (
                <li key={i} className="text-xs text-rose2-400">• {r}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {proposal.tests && (
        <div className="mt-2">
          <button
            onClick={() => setShowTests((s) => !s)}
            className="inline-flex items-center gap-1.5 text-xs text-brand-300 hover:text-brand-200"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition ${showTests ? "rotate-180" : ""}`} />
            {showTests ? "Hide" : "Show"} generated tests
            {proposal.qa_notes?.testFile ? ` (${proposal.qa_notes.testFile})` : ""}
          </button>
          {showTests && (
            <pre className="scrollbar-thin mt-2 max-h-72 overflow-auto rounded-lg border border-white/10 bg-ink-950/70 p-3 font-mono text-xs leading-relaxed text-ink-200">
              {proposal.tests}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-400">
        {icon}
        {title}
      </h4>
      {children}
    </div>
  );
}

function Pill({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <span
      className={`rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${
        accent
          ? "border-emerald2-500/30 bg-emerald2-500/10 text-emerald2-400"
          : "border-white/10 bg-white/[0.04] text-ink-300"
      }`}
    >
      {label}
    </span>
  );
}
