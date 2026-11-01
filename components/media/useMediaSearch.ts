"use client";

import { useCallback, useEffect, useState } from "react";

export interface LibraryAsset {
  id: string;
  title: string;
  alt_text: string | null;
  tags: string[];
  is_public: boolean;
  updated_at: string;
  width?: number;
  height?: number;
}

const PAGE = 24;

/**
 * The media library as a search box and a growing list: searches as you type (after a short pause), pages with
 * `loadMore`, and `reload` fetches the first page again. Staff only, like the route it calls, unless `endpoint`
 * is another list route with the same shape (a member's own images).
 */
export function useMediaSearch(endpoint = "/api/media") {
  const [q, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  const load = useCallback(async (term: string, offset: number, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${endpoint}?q=${encodeURIComponent(term)}&limit=${PAGE}&offset=${offset}`, { signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Couldn't load the library");
      const page: LibraryAsset[] = body.assets;
      setAssets((current) => (offset === 0 ? page : [...current, ...page]));
      setMore(page.length === PAGE);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(q, 0, controller.signal), q && reloads === 0 ? 250 : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, reloads, load]);

  return {
    q,
    searched,
    setQ: (value: string) => {
      setQuery(value);
      setSearched(true);
    },
    assets,
    more,
    loading,
    error,
    setError,
    loadMore: () => load(q, assets.length),
    reload: () => setReloads((n) => n + 1),
  };
}
