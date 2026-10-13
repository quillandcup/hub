/**
 * Query syntax for the universal search bar. It is the chat syntax (lib/chat/search-syntax.ts:
 * `in:`, `from:`, `before:`, `after:`, `on:`, `during:`, `has:`, `is:`, "phrases", `-excluded`,
 * `prefix*`) with two changes: `in:` scopes to one resource kind (`in:members`; `kind:` and `type:`
 * mean the same) and `channel:` picks a chat channel (what `in:` means in chat's own search), plus
 * a few kind-specific operators (`email:`, `status:`). Parsing is pure: callers turn the result into per-kind queries,
 * and decide which operators the viewer may use (see `allowedOperators`).
 */
import { parseSearch, type ParsedSearch } from "@/lib/chat/search-syntax";

export const SEARCH_KINDS = ["pages", "channels", "members", "prickles", "projects", "books", "awards", "events", "chat"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

/** Kinds only admins can search, by the same names. */
export const ADMIN_SEARCH_KINDS = ["programs", "badges", "feedback"] as const;
export type AdminSearchKind = (typeof ADMIN_SEARCH_KINDS)[number];
export type AnySearchKind = SearchKind | AdminSearchKind;

const KIND_ALIASES: Record<string, AnySearchKind> = {
  page: "pages", nav: "pages", navigation: "pages",
  channel: "channels",
  member: "members", people: "members", person: "members",
  prickle: "prickles",
  project: "projects",
  book: "books",
  award: "awards",
  event: "events",
  message: "chat", messages: "chat",
  program: "programs", badge: "badges",
};

export interface OperatorInfo {
  name: string;
  /** What to show in the suggestion list after typing `:`. */
  hint: string;
  example: string;
  /** Kinds it applies to; undefined = all. */
  kinds?: AnyKind[];
  adminOnly?: boolean;
}
type AnyKind = AnySearchKind;

const DATED_KINDS: AnyKind[] = ["prickles", "books", "awards", "events", "chat"];

export const OPERATORS: OperatorInfo[] = [
  { name: "in", hint: "Only one kind of result", example: "in:members" },
  { name: "from", hint: "Who wrote, hosts, won or attended it (from:me works)", example: "from:fern", kinds: ["chat", "prickles", "books", "projects", "awards", "events"] },
  { name: "channel", hint: "A chat channel", example: "channel:general", kinds: ["chat"] },
  { name: "before", hint: "Before a date (YYYY, YYYY-MM or YYYY-MM-DD)", example: "before:2026-10-01", kinds: DATED_KINDS },
  { name: "after", hint: "After a date", example: "after:2026-10-01", kinds: DATED_KINDS },
  { name: "on", hint: "On a day, month or year", example: "on:2026-10-09", kinds: DATED_KINDS },
  { name: "during", hint: "During a month or year", example: "during:2026-10", kinds: DATED_KINDS },
  { name: "has", hint: "Has a file, link or reaction", example: "has:link", kinds: ["chat"] },
  { name: "is", hint: "Only threads", example: "is:thread", kinds: ["chat"] },
  { name: "email", hint: "Member email", example: "email:@example.org", kinds: ["members"], adminOnly: true },
  { name: "status", hint: "Membership status", example: "status:active", kinds: ["members"], adminOnly: true },
];

/** Operators this parser reads itself, on top of parseSearch's. */
const OWN = new Set(["in", "kind", "type", "channel", "email", "status"]);

export interface UniversalQuery extends ParsedSearch {
  /** Set by `in:`; undefined searches every kind the viewer can see. */
  kind?: AnySearchKind;
  /** `in:` was given but isn't a kind we know (shown back as "No such kind"). */
  unknownKind?: string;
  email?: string;
  status?: string;
  /** The raw input, trimmed. */
  raw: string;
}

export function resolveKind(value: string): AnySearchKind | undefined {
  const v = value.toLowerCase();
  if ((SEARCH_KINDS as readonly string[]).includes(v) || (ADMIN_SEARCH_KINDS as readonly string[]).includes(v)) return v as AnySearchKind;
  return KIND_ALIASES[v];
}

/** Splits like chat's tokenizer: spaces, with "quoted phrases" kept whole. */
const tokenize = (input: string): string[] => input.match(/-?"[^"]*"?|\S+/g) ?? [];

export function parseUniversal(input: string): UniversalQuery {
  const raw = input.trim();
  const rest: string[] = [];
  const own: Pick<UniversalQuery, "kind" | "unknownKind" | "email" | "status"> = {};

  for (const token of tokenize(raw)) {
    const m = /^([a-z]+):(.+)$/i.exec(token);
    const key = m?.[1].toLowerCase();
    if (!m || !key || !OWN.has(key)) { rest.push(token); continue; }
    const value = m[2].replace(/^"|"$/g, "");
    if (key === "channel") {
      rest.push(`in:${value}`);
    } else if (key === "in" && value.startsWith("#")) {
      // Chat's own habit, in:#general, still reaches the channel.
      rest.push(token);
    } else if (key === "in" || key === "kind" || key === "type") {
      const kind = resolveKind(value);
      if (kind) own.kind = kind; else own.unknownKind = value;
    } else if (key === "email") own.email = value.replace(/^@/, "");
    else if (key === "status") own.status = value.toLowerCase();
  }

  return { ...parseSearch(rest.join(" ")), ...own, raw };
}

/** True when the query has something to search for: words or any filter. */
export function hasCriteria(q: UniversalQuery): boolean {
  return Boolean(
    q.tsquery || q.inChannel || q.from || q.after || q.before || q.hasFiles || q.hasLink || q.hasReaction || q.isThread || q.email || q.status
  );
}

/**
 * Whether `kind` can honor every filter the query sets. A filter a kind has no column for (`from:`
 * on members, `after:` on channels) must drop the kind: left to run, it would list everything as
 * if the filter matched. Words and `in:` never disqualify a kind.
 */
export function kindHonors(kind: SearchKind, q: UniversalQuery): boolean {
  const has = (op: string) => OPERATORS.find((o) => o.name === op)?.kinds?.includes(kind) ?? true;
  if (q.from && !has("from")) return false;
  if ((q.after || q.before) && !has("after")) return false;
  if ((q.email || q.status) && kind !== "members") return false;
  if ((q.hasFiles || q.hasLink || q.hasReaction || q.isThread || q.inChannel) && kind !== "chat") return false;
  return true;
}

/** Operators the viewer may use, for the suggestion list and for ignoring the rest. */
export function allowedOperators(isAdmin: boolean): OperatorInfo[] {
  return OPERATORS.filter((o) => isAdmin || !o.adminOnly);
}

/** Operators whose name starts with what was typed before a `:` (for suggestions). */
export function suggestOperators(typed: string, isAdmin: boolean): OperatorInfo[] {
  const t = typed.toLowerCase();
  return allowedOperators(isAdmin).filter((o) => o.name.startsWith(t));
}

/** The query with any `in:`/`kind:`/`type:` scope replaced by `in:<kind>` (none when `kind` is undefined). */
export function withKind(raw: string, kind?: AnySearchKind): string {
  const rest = tokenize(raw).filter((t) => !/^(in|kind|type):(?!#)/i.test(t)).join(" ");
  return kind ? `${rest} in:${kind}`.trim() : rest;
}

/** The positive plain words to match, without quotes; "-excluded" words are skipped. */
export function matchWords(q: UniversalQuery): string[] {
  return (q.text.match(/-?"[^"]*"?|\S+/g) ?? [])
    .filter((t) => !t.startsWith("-"))
    .map((t) => t.replace(/^"|"$|\*$/g, "").trim())
    .filter(Boolean);
}
