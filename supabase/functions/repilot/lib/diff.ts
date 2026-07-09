// ---------------------------------------------------------------------------
// Diff parsing utilities
// Parses unified git diffs and extracts final file content.
// ---------------------------------------------------------------------------

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

/**
 * Parse a unified diff string into structured files + hunks + lines.
 */
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
    if (line.startsWith("--- ") && currentFile) continue;
    if (line.startsWith("+++ ") && currentFile) continue;
    if (line.startsWith("@@") && currentFile) {
      const m = line.match(/@@\s-(\d+)(?:,\d+)?\s\+(\d+)(?:,\d+)?\s@@(.*)/);
      oldNo = m ? parseInt(m[1], 10) : 0;
      newNo = m ? parseInt(m[2], 10) : 0;
      currentHunk = { header: line, lines: [], raw: line + "\n" };
      currentFile.hunks.push(currentHunk);
      continue;
    }
    if (!currentHunk || !currentFile) {
      if (!currentFile) {
        currentFile = { path: "unknown", additions: 0, deletions: 0, hunks: [], raw: "" };
        files.push(currentFile);
        currentHunk = { header: "@@ hunk", lines: [], raw: "" };
        currentFile.hunks.push(currentHunk);
      }
    }
    if (line.startsWith("+")) {
      currentHunk!.lines.push({ type: "add", content: line.slice(1), newNo: ++newNo });
      currentFile!.additions++;
    } else if (line.startsWith("-")) {
      currentHunk!.lines.push({ type: "del", content: line.slice(1), oldNo: oldNo++ });
      currentFile!.deletions++;
    } else if (line.startsWith("\\")) {
      currentHunk!.lines.push({ type: "meta", content: line });
    } else {
      const content = line.startsWith(" ") ? line.slice(1) : line;
      currentHunk!.lines.push({ type: "context", content, oldNo: oldNo++, newNo: newNo++ });
    }
    if (currentHunk) currentHunk.raw += line + "\n";
  }
  return files;
}

/**
 * Extract the final (post-diff) content of a file from a diff.
 * Reconstructs from context + added lines, dropping deleted lines.
 */
export function extractFinalContent(diff: string, filePath: string): string {
  const files = parseDiff(diff);
  const f = files.find((x) => x.path === filePath || x.path.endsWith(filePath));
  if (!f) return "";
  const out: string[] = [];
  for (const h of f.hunks) {
    for (const l of h.lines) {
      if (l.type === "add" || l.type === "context") out.push(l.content);
    }
  }
  return out.join("\n");
}
