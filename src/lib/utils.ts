/** Format milliseconds into a compact human duration. */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

/** Format an ISO timestamp into a short local time. */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 5000) return "just now";
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  return `${Math.round(diff / 3600000)}h ago`;
}

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  raw: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
  raw: string;
}

export interface DiffLine {
  type: "add" | "del" | "context" | "meta";
  content: string;
  oldNo?: number;
  newNo?: number;
}

/** Parse a unified diff string into structured files + hunks + lines. */
export function parseDiff(diff: string): DiffFile[] {
  if (!diff) return [];
  const lines = diff.split("\n");
  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (m) {
        currentFile = { path: m[2], additions: 0, deletions: 0, hunks: [], raw: "" };
        files.push(currentFile);
        currentHunk = null;
      }
      continue;
    }
    if (line.startsWith("--- ") && currentFile) {
      continue;
    }
    if (line.startsWith("+++ ") && currentFile) {
      continue;
    }
    if (line.startsWith("@@") && currentFile) {
      const m = line.match(/@@\s-(\d+)(?:,\d+)?\s\+(\d+)(?:,\d+)?\s@@(.*)/);
      oldNo = m ? parseInt(m[1], 10) : 0;
      newNo = m ? parseInt(m[2], 10) : 0;
      currentHunk = { header: line, lines: [], raw: line + "\n" };
      currentFile.hunks.push(currentHunk);
      continue;
    }
    if (!currentHunk || !currentFile) {
      // tolerate diffs without proper headers
      if (!currentFile) {
        currentFile = { path: "unknown", additions: 0, deletions: 0, hunks: [], raw: "" };
        files.push(currentFile);
        currentHunk = { header: "@@ hunk", lines: [], raw: "" };
        currentFile.hunks.push(currentHunk);
      }
    }
    if (line.startsWith("+")) {
      currentHunk!.lines.push({ type: "add", content: line.slice(1), newNo: ++newNo });
      currentFile.additions++;
    } else if (line.startsWith("-")) {
      currentHunk!.lines.push({ type: "del", content: line.slice(1), oldNo: oldNo++ });
      currentFile.deletions++;
    } else if (line.startsWith("\\")) {
      currentHunk!.lines.push({ type: "meta", content: line });
    } else {
      const content = line.startsWith(" ") ? line.slice(1) : line;
      currentHunk!.lines.push({ type: "context", content, oldNo: oldNo++, newNo: newNo++ });
    }
    currentHunk!.raw += line + "\n";
  }
  return files;
}

/** Reconstruct a unified diff from approved files/hunks for PR submission. */
export function reconstructFile(file: DiffFile, approvedHunks: Set<number>): string {
  // For PR creation we need the full new file content, not just the diff.
  // We approximate by applying approved hunks; the edge function commits file
  // contents directly, so the caller should pass final file contents instead.
  return file.hunks
    .filter((_, i) => approvedHunks.has(i))
    .map((h) => h.raw)
    .join("\n");
}

/** Extract the final (post-diff) content of a file from a proposal diff + original.
 *  Falls back to the added lines if the original isn't available. */
export function extractFinalContent(diff: string, filePath: string): string {
  const files = parseDiff(diff);
  const f = files.find((x) => x.path === filePath || x.path.endsWith(filePath));
  if (!f) return "";
  // Reconstruct from context + added lines, dropping deleted lines.
  const out: string[] = [];
  for (const h of f.hunks) {
    for (const l of h.lines) {
      if (l.type === "add" || l.type === "context") out.push(l.content);
    }
  }
  return out.join("\n");
}
