import { OPERATORS, parseUniversal, wantsChat } from "@/lib/search/syntax";

/** Where a search happened: the header palette, the full results page, or the chat search page. */
export const SEARCH_SURFACES = ["palette", "page", "chat_page"] as const;
export type SearchSurface = (typeof SEARCH_SURFACES)[number];

/** What a search looked like, without what it said. */
export interface SearchShape {
  /** The `in:` scope: a kind name, "all" when there is none, or "unknown" when it named no kind. */
  kind: string;
  /** Operator names used, sorted and comma-separated (`from,in`), never their values. */
  operators: string;
  /** Words and phrases that aren't operators, capped. */
  words: number;
  /** Whether the query asks for chat messages to be searched. */
  wantsChat: boolean;
}

const OPERATOR_NAMES = new Set([...OPERATORS.map((o) => o.name), "kind", "type"]);
const TOKEN = /-?(?:[a-z]+:)?"[^"]*"?|\S+/gi;
const MAX_WORDS = 50;

/**
 * The shape of a search query for usage analytics (lib/analytics/events.ts: `search_ran`). A query
 * is what a member typed, so it can hold a name, an email or a phrase from a message: none of it is
 * kept. What is: which kind it was scoped to (a fixed list), which operators it used (by name only,
 * `from:fern` is just "from"), and how many words it had.
 */
export function searchShape(input: string): SearchShape {
  const parsed = parseUniversal(input);
  const operators = new Set<string>();
  let words = 0;
  for (const token of input.match(TOKEN) ?? []) {
    const name = /^-?([a-z]+):/i.exec(token)?.[1].toLowerCase();
    if (name && OPERATOR_NAMES.has(name)) operators.add(name === "kind" || name === "type" ? "in" : name);
    else words++;
  }
  return {
    kind: parsed.unknownKind ? "unknown" : (parsed.kind ?? "all"),
    operators: [...operators].sort().join(","),
    words: Math.min(words, MAX_WORDS),
    wantsChat: wantsChat(parsed),
  };
}
