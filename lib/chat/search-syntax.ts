/**
 * Slack's search syntax for the chat search box: `in:#channel`, `from:@name` (or `from:me`),
 * `before:`, `after:`, `on:`, `during:` (a date, month or year), `has:file|link|reaction`,
 * `is:thread`, "exact phrases", `-excluded` words and `prefix*` wildcards. Anything else is plain
 * words. Parsing is pure; the page turns the result into search_chat_messages arguments.
 */

export interface ParsedSearch {
  /** A to_tsquery expression for the words, or "" when there are none. */
  tsquery: string;
  /** The plain-words part as typed, for showing back. */
  text: string;
  inChannel?: string;
  from?: string;
  /** Inclusive lower and exclusive upper bound, ISO. */
  after?: string;
  before?: string;
  hasFiles?: boolean;
  hasLink?: boolean;
  hasReaction?: boolean;
  isThread?: boolean;
}

const DAY = 86_400_000;
const WORD = /[\p{L}\p{N}_]+/gu;

/** The words in a term, safe to put in a tsquery (everything else is dropped). */
const words = (s: string): string[] => s.match(WORD) ?? [];

const utc = (y: number, m: number, d: number) => Date.UTC(y, m, d);

/** [start, end) of a YYYY-MM-DD day, YYYY-MM month or YYYY year in UTC, or null. */
function period(value: string): [number, number] | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) {
    const start = utc(+m[1], +m[2] - 1, +m[3]);
    return Number.isNaN(start) || new Date(start).getUTCMonth() !== +m[2] - 1 ? null : [start, start + DAY];
  }
  m = /^(\d{4})-(\d{2})$/.exec(value);
  if (m && +m[2] >= 1 && +m[2] <= 12) return [utc(+m[1], +m[2] - 1, 1), utc(+m[1], +m[2], 1)];
  m = /^(\d{4})$/.exec(value);
  return m ? [utc(+m[1], 0, 1), utc(+m[1] + 1, 0, 1)] : null;
}

const iso = (t: number) => new Date(t).toISOString();

/** Splits on spaces, keeping "quoted phrases" (and -"phrases") whole. */
function tokenize(input: string): string[] {
  return input.match(/-?"[^"]*"?|\S+/g) ?? [];
}

export function parseSearch(input: string): ParsedSearch {
  const out: ParsedSearch = { tsquery: "", text: "" };
  const terms: string[] = [];
  const plain: string[] = [];
  const bounds: { after?: number; before?: number } = {};

  for (const token of tokenize(input)) {
    const mod = /^(in|from|before|after|on|during|has|is):(.+)$/i.exec(token);
    if (mod) {
      const key = mod[1].toLowerCase();
      const value = mod[2].replace(/^[#@]/, "");
      const p = period(value);
      if (key === "in" && value) { out.inChannel = value; continue; }
      if (key === "from" && value) { out.from = value; continue; }
      if (key === "has" && ["file", "files"].includes(value.toLowerCase())) { out.hasFiles = true; continue; }
      if (key === "has" && value.toLowerCase() === "link") { out.hasLink = true; continue; }
      if (key === "has" && value.toLowerCase() === "reaction") { out.hasReaction = true; continue; }
      if (key === "is" && value.toLowerCase() === "thread") { out.isThread = true; continue; }
      if (p && key === "after") { bounds.after = p[1]; continue; }
      if (p && key === "before") { bounds.before = p[0]; continue; }
      if (p && (key === "on" || key === "during")) { bounds.after = p[0]; bounds.before = p[1]; continue; }
    }

    plain.push(token);
    const negated = token.startsWith("-");
    const body = negated ? token.slice(1) : token;
    if (body.startsWith('"')) {
      const w = words(body);
      if (w.length === 0) continue;
      const phrase = w.map((x) => `'${x}'`).join(" <-> ");
      terms.push(negated ? `!(${phrase})` : `(${phrase})`);
      continue;
    }
    const w = words(body);
    if (w.length === 0) continue;
    // "a-b" or "a.b" is searched as the words next to each other, like Postgres tokenizes it.
    const expr = w.map((x, i) => `'${x}'${body.endsWith("*") && i === w.length - 1 ? ":*" : ""}`).join(" <-> ");
    terms.push(negated ? `!(${expr})` : `(${expr})`);
  }

  out.tsquery = terms.join(" & ");
  out.text = plain.join(" ");
  if (bounds.after !== undefined) out.after = iso(bounds.after);
  if (bounds.before !== undefined) out.before = iso(bounds.before);
  return out;
}
