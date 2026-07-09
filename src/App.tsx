import { useEffect, useState } from "react";
import { Landing } from "./views/Landing";
import { AnalysisView } from "./views/AnalysisView";
import { GithubLogo } from "./components/icons";

type Route = { name: "home" } | { name: "analysis"; runId: string };

function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (h.startsWith("run/")) {
    const runId = h.slice(4);
    if (runId) return { name: "analysis", runId };
  }
  return { name: "home" };
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash());

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const goHome = () => {
    window.location.hash = "";
    setRoute({ name: "home" });
  };
  const goAnalysis = (runId: string) => {
    window.location.hash = `#/run/${runId}`;
    setRoute({ name: "analysis", runId });
  };

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      {/* ambient background */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-brand-600/20 blur-[140px]" />
        <div className="absolute top-1/3 -right-40 h-[420px] w-[420px] rounded-full bg-emerald2-500/10 blur-[120px]" />
        <div className="absolute bottom-0 -left-40 h-[380px] w-[380px] rounded-full bg-brand-500/10 blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
      </div>

      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink-950/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <button onClick={goHome} className="group flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-glow">
              <GithubLogo className="h-5 w-5 text-white" />
            </span>
            <span className="flex flex-col items-start leading-none">
              <span className="text-[15px] font-semibold tracking-tight text-white">
                RepoPilot<span className="text-brand-400"> AI</span>
              </span>
              <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-ink-400">
                Multi-Agent
              </span>
            </span>
          </button>
          <nav className="flex items-center gap-1.5">
            <a
              href="https://github.com/Snigdha-Gayathri/Repo-Pilot"
              target="_blank"
              rel="noreferrer"
              className="btn-ghost"
            >
              <GithubLogo className="h-4 w-4" />
              <span className="hidden sm:inline">Source</span>
            </a>
          </nav>
        </div>
      </header>

      <main>
        {route.name === "home" && <Landing onStart={goAnalysis} />}
        {route.name === "analysis" && <AnalysisView runId={route.runId} onHome={goHome} />}
      </main>

      <footer className="border-t border-white/[0.06] py-8">
        <div className="mx-auto max-w-7xl px-4 text-center text-xs text-ink-400 sm:px-6">
          RepoPilot AI — eight AI agents, one reviewed pull request. Powered by LangGraph &amp; Gemini.
        </div>
      </footer>
    </div>
  );
}
