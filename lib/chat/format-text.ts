/**
 * The formatting a message box can apply to the text it holds. A Hub message is plain text that Slack reads as
 * mrkdwn (`*bold*`, `_italic_`, `~strike~`, backticks, fences, `> quote`), and the chat reads the same way, so
 * formatting is markers written into the text, not a separate document. Pure: the box gives the text and the
 * selection, and gets the new text and selection back. Slack has no underline, so there is none here.
 */

export type FormatKind = "bold" | "italic" | "strike" | "code" | "codeblock" | "quote" | "bullets" | "numbers";

export type TextEdit = { value: string; start: number; end: number };

const INLINE: Partial<Record<FormatKind, string>> = { bold: "*", italic: "_", strike: "~", code: "`" };
const FENCE = "```";

/** Wraps the selection in the marker, or takes the marker off a selection that is already wrapped (inside or just outside it). */
function toggleWrap(value: string, start: number, end: number, open: string, close: string): TextEdit {
  const selected = value.slice(start, end);
  if (selected.startsWith(open) && selected.endsWith(close) && selected.length >= open.length + close.length) {
    const inner = selected.slice(open.length, selected.length - close.length);
    return { value: value.slice(0, start) + inner + value.slice(end), start, end: start + inner.length };
  }
  if (value.slice(start - open.length, start) === open && value.slice(end, end + close.length) === close && start >= open.length) {
    return { value: value.slice(0, start - open.length) + selected + value.slice(end + close.length), start: start - open.length, end: end - open.length };
  }
  // Slack ignores emphasis with a space just inside the marker, so the markers hug the words.
  const lead = selected.length - selected.trimStart().length;
  const trimmed = selected.trim();
  const from = start + lead;
  const to = from + trimmed.length;
  return {
    value: `${value.slice(0, from)}${open}${trimmed}${close}${value.slice(to)}`,
    start: from + open.length,
    end: to + open.length,
  };
}

const LINE_PREFIX: Record<"quote" | "bullets" | "numbers", RegExp> = { quote: /^> ?/, bullets: /^[•◦▪] /, numbers: /^\d+\. / };

function prefixFor(kind: "quote" | "bullets" | "numbers", n: number): string {
  return kind === "quote" ? "> " : kind === "bullets" ? "• " : `${n}. `;
}

/** Puts the prefix on every line the selection touches (numbering them), or takes it off when they all have it. */
function toggleLines(value: string, start: number, end: number, kind: "quote" | "bullets" | "numbers"): TextEdit {
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const newline = value.indexOf("\n", end);
  const to = newline === -1 ? value.length : newline;
  const lines = value.slice(from, to).split("\n");
  const re = LINE_PREFIX[kind];
  const filled = lines.filter((l) => l.trim() !== "");
  const off = filled.length > 0 && filled.every((l) => re.test(l));
  let n = 0;
  const next = lines.map((line) => {
    if (off) return line.replace(re, "");
    // A blank line between items stays blank, unless it is the only line (an empty box gets its first prefix).
    if (line.trim() === "" && lines.length > 1) return line;
    return `${prefixFor(kind, ++n)}${line.replace(re, "")}`;
  });
  const block = next.join("\n");
  const edited = value.slice(0, from) + block + value.slice(to);
  const collapsed = start === end && lines.length === 1;
  const caret = collapsed ? Math.max(from, start + (block.length - lines[0].length)) : from;
  return collapsed ? { value: edited, start: caret, end: caret } : { value: edited, start: from, end: from + block.length };
}

export function applyFormat(value: string, start: number, end: number, kind: FormatKind): TextEdit {
  const [a, b] = start <= end ? [start, end] : [end, start];
  const marker = INLINE[kind];
  if (marker) return toggleWrap(value, a, b, marker, marker);
  if (kind === "codeblock") return toggleWrap(value, a, b, `${FENCE}\n`, `\n${FENCE}`);
  return toggleLines(value, a, b, kind as "quote" | "bullets" | "numbers");
}

/** The format a keyboard shortcut asks for (Cmd/Ctrl+B, +I, +Shift+X as in Slack), or null. */
export function shortcutFormat(e: { key: string; shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }): FormatKind | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (!e.shiftKey && key === "b") return "bold";
  if (!e.shiftKey && key === "i") return "italic";
  if (e.shiftKey && key === "x") return "strike";
  return null;
}
