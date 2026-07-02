import { useEffect, useMemo, useState } from "react";
import {
  GitPullRequest,
  X,
  Check,
  FileCode2,
  AlertCircle,
  Loader2,
  ExternalLink,
  ShieldCheck,
  Lock,
} from "lucide-react";
import type { Issue, Proposal } from "../lib/types";
import { fetchProposals, startGithubOAuth, completeGithubOAuth } from "../lib/api";
import { DiffViewer, type ApprovalState } from "./DiffViewer";
import { parseDiff } from "../lib/utils";

export function PrModal({
  runId,
  issues,
  onClose,
}: {
  runId: string;
  issues: Issue[];
  onClose: () => void;
}) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [approval, setApproval] = useState<ApprovalState>({ files: {}, hunks: {} });
  const [phase, setPhase] = useState<"review" | "oauth" | "creating" | "done" | "error">("review");
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [oauthCode, setOauthCode] = useState("");

  useEffect(() => {
    fetchProposals(runId).then((p) => {
      // only selected proposals
      const selected = p.filter((x) => x.is_selected);
      setProposals(selected);
      // pre-approve all files by default
      const files: Record<string, boolean> = {};
      const hunks: Record<string, Set<number>> = {};
      for (const prop of selected) {
        const files2 = parseDiff(prop.diff);
        files2.forEach((f, fi) => {
          files[`${prop.id}:${f.path}`] = true;
          const set = new Set<number>();
          f.hunks.forEach((_, hi) => set.add(hi));
          hunks[`${prop.id}:${f.path}::${fi}`] = set;
        });
      }
      setApproval({ files, hunks });
      setLoading(false);
    });
  }, [runId]);

  const approvedFiles = useMemo(() => {
    const out: { path: string; content: string }[] = [];
    for (const prop of proposals) {
      const files = parseDiff(prop.diff);
      for (const f of files) {
        const key = `${prop.id}:${f.path}`;
        if (!approval.files[key]) continue;
        // reconstruct final content from context + added lines
        const lines: string[] = [];
        for (const h of f.hunks) {
          for (const l of h.lines) {
            if (l.type === "add" || l.type === "context") lines.push(l.content);
          }
        }
        out.push({ path: f.path, content: lines.join("\n") });
      }
    }
    return out;
  }, [proposals, approval]);

  const approvedCount = Object.values(approval.files).filter(Boolean).length;
  const totalFiles = Object.keys(approval.files).length;

  async function handleCreatePr() {
    setPhase("oauth");
  }

  async function handleOauthSubmit() {
    if (!oauthCode.trim()) {
      setError("Paste the GitHub authorization code to continue.");
      return;
    }
    setPhase("creating");
    setError(null);
    try {
      const result = await completeGithubOAuth(oauthCode.trim(), runId, approvedFiles);
      if (result.error) {
        setError(result.error);
        setPhase("error");
      } else if (result.pr_url) {
        setPrUrl(result.pr_url);
        setPhase("done");
      } else {
        setError("Unexpected response from server.");
        setPhase("error");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "PR creation failed.");
      setPhase("error");
    }
  }

  async function handleRedirectOauth() {
    try {
      const authUrl = await startGithubOAuth(window.location.origin + window.location.pathname);
      window.open(authUrl, "_blank");
      setPhase("oauth");
    } catch (e) {
      setError(e instanceof Error ? e.message : "GitHub OAuth not configured.");
      setPhase("error");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className="card relative z-10 flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-500/15 text-brand-300">
              <GitPullRequest className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-white">Create Pull Request</h2>
              <p className="text-xs text-ink-400">
                {phase === "review"
                  ? "Review and approve changes before anything touches GitHub."
                  : phase === "oauth"
                  ? "Authorize with GitHub to open the pull request."
                  : phase === "done"
                  ? "Pull request opened successfully."
                  : "Working…"}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost -mr-2">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* body */}
        <div className="scrollbar-thin flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center gap-2 py-8 text-sm text-ink-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading approved proposals…
            </div>
          )}

          {!loading && phase === "review" && (
            <>
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-brand-500/20 bg-brand-500/[0.06] px-3 py-2 text-xs text-ink-200">
                <ShieldCheck className="h-4 w-4 text-brand-300" />
                RepoPilot will <strong className="mx-1 text-white">never</strong> modify a repository
                automatically. Approve the files you want, then click Create Pull Request.
              </div>
              <div className="mb-4 flex items-center justify-between text-sm">
                <span className="text-ink-300">
                  {approvedCount} of {totalFiles} files approved
                </span>
                <span className="text-xs text-ink-400">{proposals.length} proposal(s)</span>
              </div>
              <div className="space-y-4">
                {proposals.map((p) => {
                  const issue = issues.find((i) => i.id === p.issue_id);
                  return (
                    <div key={p.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <FileCode2 className="h-4 w-4 text-ink-400" />
                        <span className="text-sm font-medium text-ink-100">
                          {issue?.title ?? p.approach}
                        </span>
                        <span className="text-xs text-ink-500">— {p.approach}</span>
                      </div>
                      <DiffViewer
                        diff={p.diff}
                        approvalKey={`${p.id}`}
                        approval={approval}
                        onApprovalChange={setApproval}
                        reviewable
                      />
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {!loading && phase === "oauth" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Lock className="h-4 w-4 text-brand-300" /> Step 1 — Authorize on GitHub
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-300">
                  Click below to open GitHub's official OAuth consent screen. RepoPilot requests
                  <code className="mx-1 rounded bg-white/[0.06] px-1 font-mono text-ink-200">repo</code>
                  scope so it can fork the repository, create a branch, commit your approved changes,
                  and open a pull request in your account.
                </p>
                <button onClick={handleRedirectOauth} className="btn-primary mt-3">
                  <GitPullRequest className="h-4 w-4" />
                  Authorize with GitHub
                </button>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Check className="h-4 w-4 text-emerald2-400" /> Step 2 — Paste the authorization code
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-300">
                  After authorizing, GitHub redirects with a <code className="rounded bg-white/[0.06] px-1 font-mono text-ink-200">code</code> parameter.
                  Paste it here to finish creating the pull request.
                </p>
                <input
                  value={oauthCode}
                  onChange={(e) => setOauthCode(e.target.value)}
                  placeholder="Paste the code from the redirect URL"
                  className="input mt-3 font-mono text-sm"
                />
                <button onClick={handleOauthSubmit} className="btn-primary mt-3">
                  Create Pull Request
                </button>
              </div>
            </div>
          )}

          {phase === "creating" && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-brand-400" />
              <p className="text-sm text-ink-200">Forking, branching, committing, and opening your pull request…</p>
              <p className="text-xs text-ink-400">This may take a few seconds.</p>
            </div>
          )}

          {phase === "done" && prUrl && (
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald2-500/15 text-emerald2-400">
                <Check className="h-7 w-7" />
              </span>
              <h3 className="text-lg font-semibold text-white">Pull request created!</h3>
              <a
                href={prUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-primary"
              >
                <ExternalLink className="h-4 w-4" />
                View on GitHub
              </a>
            </div>
          )}

          {phase === "error" && error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose2-500/30 bg-rose2-500/10 p-4 text-sm text-rose2-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* footer */}
        {phase === "review" && !loading && (
          <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-4">
            <p className="text-xs text-ink-400">
              {approvedCount === 0 ? "Approve at least one file to continue." : `${approvedCount} file(s) will be included.`}
            </p>
            <button
              onClick={handleCreatePr}
              disabled={approvedCount === 0}
              className="btn-primary"
            >
              <GitPullRequest className="h-4 w-4" />
              Create Pull Request
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
