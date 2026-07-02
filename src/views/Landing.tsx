import { useState } from "react";
import {
  Compass,
  Search,
  PenTool,
  Code2,
  ShieldCheck,
  Gavel,
  ArrowRight,
  Sparkles,
  GitBranch,
  GitPullRequest,
  Eye,
  CheckCircle2,
  Lock,
} from "lucide-react";
import { AGENT_META, AGENT_ORDER } from "../lib/types";
import { startAnalysis } from "../lib/api";

const AGENT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Compass,
  Search,
  PenTool,
  Code2,
  ShieldCheck,
  Gavel,
};

const EXAMPLES = [
  "https://github.com/supabase/supabase",
  "https://github.com/facebook/react",
  "https://github.com/vercel/next.js",
  "https://github.com/microsoft/vscode",
];

export function Landing({ onStart }: { onStart: (runId: string) => void }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Paste a public GitHub repository URL to begin.");
      return;
    }
    if (!/github\.com[/:][\w.-]+\/[\w.-]+/i.test(trimmed)) {
      setError("That doesn't look like a GitHub URL. Try https://github.com/owner/repo");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const runId = await startAnalysis(trimmed);
      onStart(runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start analysis.");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6">
      {/* Hero */}
      <section className="pt-16 pb-12 sm:pt-24 sm:pb-16">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs font-medium text-ink-200 animate-fade-up">
            <Sparkles className="h-3.5 w-3.5 text-brand-400" />
            Six AI agents · LangGraph orchestration · Gemini reasoning
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-6xl animate-fade-up">
            Turn any public repo into a{" "}
            <span className="bg-gradient-to-r from-brand-400 via-brand-300 to-emerald2-400 bg-clip-text text-transparent">
              reviewed pull request
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-ink-300 sm:text-lg animate-fade-up">
            Paste a GitHub URL. A team of specialized AI agents clones, analyzes, hunts issues,
            drafts fixes, writes tests, and reviews the work — you stay in the loop and approve
            every change before anything touches GitHub.
          </p>

          {/* URL input */}
          <div className="mx-auto mt-8 max-w-2xl animate-fade-up">
            <div className="group relative">
              <div className="absolute -inset-px rounded-2xl bg-gradient-to-r from-brand-500/40 to-emerald2-500/30 opacity-0 blur transition group-focus-within:opacity-100" />
              <div className="relative flex flex-col gap-2 rounded-2xl border border-white/10 bg-ink-900/80 p-2 sm:flex-row sm:items-center">
                <div className="flex flex-1 items-center gap-2.5 px-3">
                  <GitBranch className="h-5 w-5 shrink-0 text-ink-400" />
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleStart()}
                    placeholder="https://github.com/owner/repository"
                    className="w-full bg-transparent py-2.5 text-sm text-ink-100 placeholder-ink-400 outline-none"
                    spellCheck={false}
                    autoCapitalize="off"
                  />
                </div>
                <button
                  onClick={handleStart}
                  disabled={loading}
                  className="btn-primary shrink-0"
                >
                  {loading ? (
                    <>
                      <span className="h-4 w-4 animate-spin-slow rounded-full border-2 border-white/30 border-t-white" />
                      Starting…
                    </>
                  ) : (
                    <>
                      Analyze
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
            {error && (
              <p className="mt-2.5 text-left text-sm text-rose2-400 animate-fade-up">{error}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-xs text-ink-400">
              <span className="text-ink-500">Try:</span>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setUrl(ex)}
                  className="rounded-md px-2 py-1 text-ink-300 transition hover:bg-white/[0.06] hover:text-ink-100"
                >
                  {ex.replace("https://github.com/", "")}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-ink-400">
            <span className="inline-flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5" /> No login needed to analyze
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5" /> Review every diff
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> Approve per file or hunk
            </span>
            <span className="inline-flex items-center gap-1.5">
              <GitPullRequest className="h-3.5 w-3.5" /> PR only on your click
            </span>
          </div>
        </div>
      </section>

      {/* Agent team */}
      <section className="py-12">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Meet the agent team
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-ink-300">
            Each agent has a single responsibility. They run in a coordinated graph, passing
            context forward — exactly like a real engineering team.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {AGENT_ORDER.map((name, i) => {
            const meta = AGENT_META[name];
            const Icon = AGENT_ICONS[meta.icon] ?? Compass;
            return (
              <div
                key={name}
                className="card group relative overflow-hidden p-5 transition hover:-translate-y-0.5 animate-fade-up"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="absolute right-0 top-0 h-24 w-24 rounded-full bg-brand-500/5 blur-2xl transition group-hover:bg-brand-500/10" />
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-ink-850">
                    <Icon className="h-5 w-5 text-brand-300" />
                  </span>
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wider text-ink-400">
                      Agent {i + 1}
                    </div>
                    <h3 className="text-base font-semibold text-white">{meta.label}</h3>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-ink-300">
                  {AGENT_DESCRIPTIONS[name]}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* How it works */}
      <section className="py-12">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            How it works
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {STEPS.map((s, i) => (
            <div key={i} className="card p-5 animate-fade-up" style={{ animationDelay: `${i * 80}ms` }}>
              <div className="mb-3 grid h-9 w-9 place-items-center rounded-lg bg-brand-500/15 text-sm font-semibold text-brand-300">
                {i + 1}
              </div>
              <h3 className="text-sm font-semibold text-white">{s.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-300">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const AGENT_DESCRIPTIONS: Record<string, string> = {
  repository_analyst:
    "Reads the project structure, frameworks, dependencies, and coding conventions to build a mental model of the codebase.",
  issue_hunter:
    "Scans for bugs, TODOs, code smells, duplicated logic, missing tests, security risks, and beginner-friendly opportunities.",
  solution_architect:
    "Proposes one or more implementation strategies per issue — with trade-offs, complexity, risk, and confidence scores.",
  code_engineer:
    "Generates production-quality code as a git-style diff, matching the repository's existing style. Two independent implementations for important issues.",
  qa_agent:
    "Reviews generated code for regressions and writes unit and integration tests that match the repo's testing conventions.",
  reviewer:
    "Compares all proposals, scores each on quality and risk, selects the best implementation, and justifies the choice.",
};

const STEPS = [
  { title: "Paste a repo URL", desc: "Any public GitHub repository. No login required to start." },
  { title: "Watch agents work", desc: "Live timeline of every agent step, with outputs and timings." },
  { title: "Review the diffs", desc: "Approve or reject changes per file or per hunk. You're in control." },
  { title: "Create a PR", desc: "Only then does RepoPilot request GitHub access and open a pull request." },
];
