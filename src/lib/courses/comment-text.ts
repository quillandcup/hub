/** Display helpers for lesson comments: links in plain text, and dates. Pure, so they can be tested on their own. */

export type TextPart = { type: "text"; value: string } | { type: "link"; value: string };

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const PAIRS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/** Drops the punctuation that ends a sentence (and a closing bracket the address never opened) from the end of a match. */
function trimAddress(raw: string): string {
  let url = raw;
  for (;;) {
    const end = url.at(-1);
    if (end === undefined) return url;
    if (".,;:!?".includes(end)) url = url.slice(0, -1);
    else if (PAIRS[end] && url.split(end).length > url.split(PAIRS[end]).length) url = url.slice(0, -1);
    else return url;
  }
}

/**
 * Splits plain text into text and `http(s)` links. Nothing else is linked and nothing is decoded: the parts are rendered as
 * text by React, so markup in a comment is shown as typed. A link never swallows the sentence's closing punctuation.
 */
export function linkifyText(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const url = trimAddress(match[0]);
    if (!/^https?:\/\/[^\s/]+/i.test(url)) continue;
    if (start > last) parts.push({ type: "text", value: text.slice(last, start) });
    parts.push({ type: "link", value: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}

/** "just now", "5 minutes ago", "3 days ago", then a plain date; `nowMs` is when the page was made, so server and browser agree. */
export function relativeAgo(iso: string, nowMs: number, timeZone: string): string {
  const seconds = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
}

/** The full date and time in the viewer's zone, for the hover text. */
export function fullDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "long", timeStyle: "short" }).format(new Date(iso));
}
