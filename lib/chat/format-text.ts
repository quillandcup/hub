/** The formats the message box offers (components/chat/FormatToolbar.tsx), named for the usage event. */
export type FormatKind = "bold" | "italic" | "strike" | "link" | "bullets" | "numbers" | "quote" | "code" | "codeblock";

/** The format a keyboard shortcut asks for (Cmd/Ctrl+B, +I, +Shift+X as in Slack), or null. The editor applies it; this is only to record it. */
export function shortcutFormat(e: { key: string; shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }): FormatKind | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (!e.shiftKey && key === "b") return "bold";
  if (!e.shiftKey && key === "i") return "italic";
  if (e.shiftKey && key === "x") return "strike";
  return null;
}
