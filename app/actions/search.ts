"use server";

import { getSearcher } from "@/lib/search/context";
import { parseUniversal } from "@/lib/search/syntax";
import { universalSearch, type KindResults } from "@/lib/search/universal";
import { MAX_QUERY_LENGTH } from "@/lib/chat/search";

export interface PaletteSearch {
  results: KindResults[];
  /** `in:` named a kind that doesn't exist. */
  unknownKind?: string;
  /** Chat messages weren't searched (the palette leaves them to the results page: they are slow). */
  chatSkipped?: boolean;
}

/**
 * The header palette's search: a few rows per kind for what's typed. Runs as the signed-in
 * viewer (see getSearcher); off, signed out or empty gives nothing rather than an error.
 */
export async function searchPalette(input: string): Promise<PaletteSearch> {
  const started = performance.now();
  const searcher = await getSearcher();
  if (!searcher) return { results: [] };
  const setupMs = Math.round(performance.now() - started);
  const query = parseUniversal(input.slice(0, MAX_QUERY_LENGTH));
  if (query.unknownKind) return { results: [], unknownKind: query.unknownKind };
  // Chat is by far the slowest kind (seconds, where the others take well under half a second), so
  // the palette leaves it to the results page unless the search is about chat.
  const chatWanted = query.kind === "chat" || !!(query.hasFiles || query.hasLink || query.hasReaction || query.isThread || query.inChannel);
  const canSearchChat = !searcher.skip.includes("chat");
  const skip = chatWanted ? searcher.skip : [...searcher.skip, "chat" as const];
  const timings: Record<string, number> = {};
  const results = await universalSearch({ ...searcher.ctx, limit: 4 }, query, { skip, timings });
  // Where the time goes on the deployed site (never the query text): setup, then each kind.
  console.log("palette search", JSON.stringify({ setupMs, totalMs: Math.round(performance.now() - started), kindsMs: timings }));
  return { results, chatSkipped: canSearchChat && !chatWanted };
}
