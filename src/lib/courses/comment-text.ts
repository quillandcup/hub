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

export type RichPart = TextPart | { type: "time"; value: string; seconds: number };

/** `2:35` or `1:02:03`: not inside a longer number or word, and not a clock time followed by am or pm. */
const TIME_PATTERN = /(?<![\w:./])(\d{1,2}:\d{2}(?::\d{2})?)(?![\w:])(?!\s?[ap]\.?m\b)/gi;

/** The seconds a typed timestamp stands for, or null when it isn't one (`2:75`, `1:75:00`). `m:ss` or `h:mm:ss`. */
export function timestampSeconds(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  if (match[3] === undefined) return second < 60 ? first * 60 + second : null;
  const third = Number(match[3]);
  return second < 60 && third < 60 ? first * 3600 + second * 60 + third : null;
}

/** A timestamp as people hear it read: "2 minutes 35 seconds". */
export function spokenTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const unit = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  return [hours > 0 ? unit(hours, "hour") : "", minutes > 0 || hours > 0 ? unit(minutes, "minute") : "", unit(seconds % 60, "second")].filter(Boolean).join(" ");
}

/**
 * `linkifyText`, and in the text between the links, typed timestamps (`2:35`) as `time` parts that the thread turns into buttons
 * which move the lesson's video. Addresses are linked first, so a time inside one stays part of it. Nothing is decoded.
 */
export function richParts(text: string): RichPart[] {
  const out: RichPart[] = [];
  for (const part of linkifyText(text)) {
    if (part.type === "link") {
      out.push(part);
      continue;
    }
    let last = 0;
    for (const match of part.value.matchAll(TIME_PATTERN)) {
      const seconds = timestampSeconds(match[1]);
      if (seconds === null) continue;
      const start = match.index ?? 0;
      if (start > last) out.push({ type: "text", value: part.value.slice(last, start) });
      out.push({ type: "time", value: match[1], seconds });
      last = start + match[1].length;
    }
    if (last < part.value.length) out.push({ type: "text", value: part.value.slice(last) });
  }
  return out;
}
