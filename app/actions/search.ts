"use server";

import { getSearcher } from "@/lib/search/context";
import { parseUniversal } from "@/lib/search/syntax";
import { universalSearch, type KindResults } from "@/lib/search/universal";
import { MAX_QUERY_LENGTH } from "@/lib/chat/search";

export interface PaletteSearch {
  results: KindResults[];
  /** `in:` named a kind that doesn't exist. */
  unknownKind?: string;
}

/**
 * The header palette's search: a few rows per kind for what's typed. Runs as the signed-in
 * viewer (see getSearcher); off, signed out or empty gives nothing rather than an error.
 */
export async function searchPalette(input: string): Promise<PaletteSearch> {
  const searcher = await getSearcher();
  if (!searcher) return { results: [] };
  const query = parseUniversal(input.slice(0, MAX_QUERY_LENGTH));
  if (query.unknownKind) return { results: [], unknownKind: query.unknownKind };
  const results = await universalSearch({ ...searcher.ctx, limit: 4 }, query, { skip: searcher.skip });
  return { results };
}
