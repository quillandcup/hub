// Which lines of which files a change added, from `git diff -U0`. Shared by the coverage gate
// (scripts/coverage-report.ts) and the code-quality report (scripts/quality-new-code.ts), so
// both mean the same thing by "new code".

/**
 * The `git diff` that lists a change's added lines. `-M` follows renames, so a file that only moved (such as the move into
 * src/) adds no lines, and one that moved and was edited adds only the edited ones; `R` keeps those files in the diff.
 */
export function addedLinesDiffArgs(base: string): string[] {
  return ["diff", "-U0", "--no-color", "-M", "--diff-filter=AMR", `${base}...HEAD`];
}

/** Added line numbers per file from `git diff -U0` output. */
export function parseAddedLines(diff: string): Map<string, Set<number>> {
  const added = new Map<string, Set<number>>();
  let file: string | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.startsWith("+++ b/") ? line.slice(6) : null;
    } else if (file && line.startsWith("@@")) {
      const m = /\+(\d+)(?:,(\d+))?/.exec(line);
      if (!m) continue;
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      const lines = added.get(file) ?? new Set<number>();
      for (let i = 0; i < count; i++) lines.add(start + i);
      added.set(file, lines);
    }
  }
  return added;
}
