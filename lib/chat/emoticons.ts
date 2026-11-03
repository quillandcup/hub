/**
 * Text emoticons (`:)`, `:'(`, `<3`) and the emoji they stand for, as Slack turns them into. Shared by the message box
 * (converts as you type) and the renderer (draws messages that carry them). Pure.
 */

export const EMOTICONS: Record<string, string> = {
  ":)": "🙂",
  ":-)": "🙂",
  ":(": "🙁",
  ":-(": "🙁",
  ":'(": "😢",
  ":D": "😃",
  ":-D": "😃",
  ";)": "😉",
  ";-)": "😉",
  ":P": "😛",
  ":-P": "😛",
  ":p": "😛",
  ":/": "😕",
  ":-/": "😕",
  ":O": "😮",
  ":-O": "😮",
  ":|": "😐",
  "<3": "❤️",
  "&lt;3": "❤️",
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ALTERNATION = Object.keys(EMOTICONS)
  .sort((a, b) => b.length - a.length)
  .map(escapeRe)
  .join("|");

/** An emoticon at the start or after whitespace, and followed by whitespace, punctuation or the end ("http://" and "10:30" are not). */
export const EMOTICON_IN_TEXT = new RegExp(`(?<=^|\\s)(${ALTERNATION})(?=$|[\\s.,!?;)])`);

/** True when the caret sits inside an open `code` span or ``` block, judged by the backticks before it. */
function insideCode(before: string): boolean {
  return (before.match(/`/g)?.length ?? 0) % 2 === 1;
}

/**
 * The text after the caret moved past a just-typed space or punctuation: the emoticon right before it becomes its emoji.
 * Null when there is nothing to convert.
 */
export function convertEmoticonBefore(value: string, caret: number): { value: string; caret: number } | null {
  const typed = value[caret - 1];
  if (typed === undefined || !/[\s.,!?;)]/.test(typed)) return null;
  const before = value.slice(0, caret - 1);
  if (insideCode(before)) return null;
  const m = new RegExp(`(?<=^|\\s)(${ALTERNATION})$`).exec(before);
  if (!m) return null;
  const emoji = EMOTICONS[m[1]];
  const next = `${before.slice(0, m.index)}${emoji}${value.slice(caret - 1)}`;
  return { value: next, caret: caret - m[1].length + emoji.length };
}
