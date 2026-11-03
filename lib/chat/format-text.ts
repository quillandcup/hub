/** The formats the message box offers (components/chat/FormatToolbar.tsx), named for the usage event. */
export type FormatKind = "bold" | "italic" | "underline" | "strike" | "link" | "bullets" | "numbers" | "quote" | "code" | "codeblock";

/** The format a keyboard shortcut asks for (Cmd/Ctrl+B, +I, +U, +Shift+X as in Slack), or null. The editor applies it; this is only to record it. */
export function shortcutFormat(e: { key: string; shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }): FormatKind | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (!e.shiftKey && key === "b") return "bold";
  if (!e.shiftKey && key === "i") return "italic";
  if (!e.shiftKey && key === "u") return "underline";
  if (e.shiftKey && key === "x") return "strike";
  return null;
}

/** How a format got into a message: from the toolbar, a keyboard shortcut, typed markers (`*bold*`, `> `, `- `, a backtick), pasted formatted text, or Tab/Shift+Tab nesting a list. */
export type FormatVia = "toolbar" | "shortcut" | "typed" | "paste" | "tab";

/** Nothing has formatted the message yet. */
export const NO_FORMATS: Record<FormatVia, boolean> = { toolbar: false, shortcut: false, typed: false, paste: false, tab: false };

/** The marks and blocks the editor has, by their names in its document, as the formats the usage events call them. */
const MARK_FORMATS: Record<string, FormatKind> = { bold: "bold", italic: "italic", underline: "underline", strike: "strike", code: "code", link: "link" };
const BLOCK_FORMATS: Record<string, FormatKind> = { bulletList: "bullets", orderedList: "numbers", blockquote: "quote", codeBlock: "codeblock" };

type Json = { [key: string]: unknown };

function collect(node: unknown, found: Set<FormatKind>) {
  if (!node || typeof node !== "object") return;
  const n = node as Json;
  const block = typeof n.type === "string" ? BLOCK_FORMATS[n.type] : undefined;
  if (block) found.add(block);
  if (Array.isArray(n.marks)) {
    for (const mark of n.marks as Json[]) {
      const kind = typeof mark?.type === "string" ? MARK_FORMATS[mark.type] : undefined;
      if (kind) found.add(kind);
    }
  }
  if (Array.isArray(n.content)) for (const child of n.content) collect(child, found);
}

/** The formats in pasted content (a ProseMirror slice as JSON): none for plain text. */
export function formatsInSlice(slice: unknown): FormatKind[] {
  const found = new Set<FormatKind>();
  collect(slice, found);
  return [...found];
}

/**
 * The formats a transaction's steps (each as JSON) applied: a mark added (`*bold*` typed), or a block wrapped around
 * a line (`> `, `- `, `1. `, a fence). Used for the transactions the editor flags as input rules.
 */
export function formatsFromSteps(steps: unknown[]): FormatKind[] {
  const found = new Set<FormatKind>();
  for (const raw of steps) {
    if (!raw || typeof raw !== "object") continue;
    const step = raw as Json;
    if (step.stepType === "addMark") {
      const kind = typeof (step.mark as Json | undefined)?.type === "string" ? MARK_FORMATS[(step.mark as Json).type as string] : undefined;
      if (kind) found.add(kind);
    } else if (step.stepType === "replaceAround" || step.stepType === "replace") {
      // The new block (or the text with its marks) is in the slice; only blocks and marks count, not plain text.
      collect(step.slice, found);
    }
  }
  return [...found];
}
