"use client";

import { useEffect } from "react";
import { trackWhenEnabled } from "@/lib/analytics/client";
import type { SearchSurface } from "@/lib/analytics/search";

/**
 * Reports a search results page that was just shown (`search_ran`), once: the page gives it a `key`
 * of the query and page number, so a new search remounts it. Renders nothing. The counts come from
 * the server render; the query text is never passed in (lib/analytics/search.ts).
 */
export default function SearchRan({
  surface,
  kind,
  operators,
  words,
  results,
  chatResults,
  chatSearched,
}: {
  surface: SearchSurface;
  kind: string;
  operators: string;
  words: number;
  results: number;
  chatResults: number;
  chatSearched: boolean;
}) {
  useEffect(
    () =>
      trackWhenEnabled("search_ran", {
        surface,
        kind,
        operators,
        words,
        results,
        chat_results: chatResults,
        chat_searched: chatSearched,
      }),
    // Once per mount: a new search remounts this through its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  return null;
}
