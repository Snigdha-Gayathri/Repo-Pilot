import { useMemo, useState } from "react";
import { Check, X, FileCode2, ChevronDown } from "lucide-react";
import { parseDiff, type DiffFile, type DiffHunk } from "../lib/utils";

export interface ApprovalState {
  files: Record<string, boolean>; // filePath -> approved
  hunks: Record<string, Set<number>>; // `${filePath}::${hunkIdx}` -> approved set
}

export function DiffViewer({
  diff,
  approvalKey,
  approval,
  onApprovalChange,
  reviewable,
}: {
  diff: string;
  approvalKey?: string;
  approval?: ApprovalState;
  onApprovalChange?: (a: ApprovalState) => void;
  reviewable?: boolean;
}) {
  const files = useMemo(() => parseDiff(diff), [diff]);

  if (files.length === 0) {
    return (
      <pre className="scrollbar-thin max-h-80 overflow-auto rounded-lg border border-white/10 bg-ink-950/70 p-3 font-mono text-xs leading-relaxed text-ink-300">
        {diff || "(no diff)"}
      </pre>
    );
  }

  return (
    <div className="space-y-3">
      {files.map((file, fi) => (
        <FileBlock
          key={`${file.path}-${fi}`}
          file={file}
          approvalKey={approvalKey}
          approval={approval}
          onApprovalChange={onApprovalChange}
          reviewable={reviewable}
        />
      ))}
    </div>
  );
}

function FileBlock({
  file,
  approvalKey,
  approval,
  onApprovalChange,
  reviewable,
}: {
  file: DiffFile;
  approvalKey?: string;
  approval?: ApprovalState;
  onApprovalChange?: (a: ApprovalState) => void;
  reviewable?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const key = approvalKey ?? file.path;
  const fileApproved = approval?.files[key] ?? false;

  const toggleFile = (val: boolean) => {
    if (!onApprovalChange || !approval) return;
    onApprovalChange({
      ...approval,
      files: { ...approval.files, [key]: val },
    });
  };

  const toggleHunk = (hunkIdx: number, val: boolean) => {
    if (!onApprovalChange || !approval) return;
    const hunkKey = `${key}::${hunkIdx}`;
    const set = new Set(approval.hunks[hunkKey] ?? []);
    if (val) set.add(hunkIdx);
    else set.delete(hunkIdx);
    onApprovalChange({
      ...approval,
      hunks: { ...approval.hunks, [hunkKey]: set },
    });
  };

  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-ink-950/60">
      {/* file header */}
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] bg-white/[0.02] px-3 py-2">
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 items-center gap-2">
          <ChevronDown className={`h-4 w-4 shrink-0 text-ink-400 transition ${open ? "" : "-rotate-90"}`} />
          <FileCode2 className="h-4 w-4 shrink-0 text-ink-400" />
          <code className="truncate font-mono text-xs text-ink-100">{file.path}</code>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs font-medium text-emerald2-400">+{file.additions}</span>
          <span className="text-xs font-medium text-rose2-400">-{file.deletions}</span>
          {reviewable && (
            <div className="ml-1 flex items-center gap-1">
              <ApproveBtn active={fileApproved} onClick={() => toggleFile(true)} />
              <RejectBtn active={fileApproved === false} onClick={() => toggleFile(false)} />
            </div>
          )}
        </div>
      </div>

      {/* hunks */}
      {open && (
        <div className="divide-y divide-white/[0.04]">
          {file.hunks.map((hunk, hi) => (
            <HunkBlock
              key={hi}
              hunk={hunk}
              approved={approval?.hunks[`${key}::${hi}`]?.has(hi) ?? false}
              onApprove={() => toggleHunk(hi, true)}
              onReject={() => toggleHunk(hi, false)}
              reviewable={reviewable}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HunkBlock({
  hunk,
  approved,
  onApprove,
  onReject,
  reviewable,
}: {
  hunk: DiffHunk;
  approved: boolean;
  onApprove: () => void;
  onReject: () => void;
  reviewable?: boolean;
}) {
  return (
    <div className="group relative">
      <div className="flex items-center justify-between gap-2 bg-white/[0.02] px-3 py-1.5">
        <code className="truncate font-mono text-[11px] text-ink-500">{hunk.header}</code>
        {reviewable && (
          <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
            <ApproveBtn small active={approved} onClick={onApprove} />
            <RejectBtn small active={approved === false} onClick={onReject} />
          </div>
        )}
      </div>
      <div className="overflow-x-auto font-mono text-xs leading-relaxed">
        <table className="w-full border-collapse">
          <tbody>
            {hunk.lines.map((line, li) => (
              <tr
                key={li}
                className={
                  line.type === "add"
                    ? "bg-emerald2-500/[0.08]"
                    : line.type === "del"
                    ? "bg-rose2-500/[0.08]"
                    : line.type === "meta"
                    ? "bg-white/[0.03]"
                    : ""
                }
              >
                <td className="w-10 select-none border-r border-white/[0.04] px-2 text-right text-[10px] tabular-nums text-ink-500">
                  {line.oldNo ?? ""}
                </td>
                <td className="w-10 select-none border-r border-white/[0.04] px-2 text-right text-[10px] tabular-nums text-ink-500">
                  {line.newNo ?? ""}
                </td>
                <td className="w-6 select-none px-1 text-center text-ink-500">
                  {line.type === "add" ? "+" : line.type === "del" ? "-" : line.type === "meta" ? "\\" : " "}
                </td>
                <td className="whitespace-pre-wrap break-words px-2 text-ink-200">
                  <SyntaxLine content={line.content} type={line.type} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Lightweight token-based syntax tinting for common languages. */
function SyntaxLine({ content, type }: { content: string; type: string }) {
  if (type === "meta") return <span className="text-ink-500">{content}</span>;
  const base = type === "add" ? "text-emerald2-400" : type === "del" ? "text-rose2-400" : "text-ink-200";
  // comment
  if (/^\s*(\/\/|#|\/\*|\*|<!--)/.test(content)) {
    return <span className="text-ink-500 italic">{content}</span>;
  }
  // string
  const strMatch = content.match(/(['"`])(.*?)\1/);
  if (strMatch) {
    const idx = content.indexOf(strMatch[0]);
    return (
      <span className={base}>
        {content.slice(0, idx)}
        <span className="text-emerald2-400">{strMatch[0]}</span>
        {content.slice(idx + strMatch[0].length)}
      </span>
    );
  }
  // keyword highlight
  const kw = /\b(import|export|from|const|let|var|function|return|if|else|for|while|class|extends|new|async|await|def|public|private|static|void|interface|type|enum|throw|try|catch|finally)\b/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = kw.exec(content))) {
    if (m.index > last) parts.push(content.slice(last, m.index));
    parts.push(
      <span key={key++} className="text-brand-300">{m[0]}</span>
    );
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push(content.slice(last));
  return <span className={base}>{parts}</span>;
}

function ApproveBtn({ active, onClick, small }: { active: boolean; onClick: () => void; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      title="Approve"
      className={`grid place-items-center rounded-md border transition ${
        small ? "h-6 w-6" : "h-7 w-7"
      } ${
        active
          ? "border-emerald2-500/40 bg-emerald2-500/20 text-emerald2-400"
          : "border-white/10 bg-white/[0.03] text-ink-500 hover:text-emerald2-400"
      }`}
    >
      <Check className={small ? "h-3 w-3" : "h-3.5 w-3.5"} />
    </button>
  );
}

function RejectBtn({ active, onClick, small }: { active: boolean; onClick: () => void; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      title="Reject"
      className={`grid place-items-center rounded-md border transition ${
        small ? "h-6 w-6" : "h-7 w-7"
      } ${
        active
          ? "border-rose2-500/40 bg-rose2-500/20 text-rose2-400"
          : "border-white/10 bg-white/[0.03] text-ink-500 hover:text-rose2-400"
      }`}
    >
      <X className={small ? "h-3 w-3" : "h-3.5 w-3.5"} />
    </button>
  );
}
