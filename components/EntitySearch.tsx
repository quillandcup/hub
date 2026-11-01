"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useBlurDelay } from "@/lib/hooks/useBlurDelay";

export interface SearchItem {
  id: string;
  name: string;
  /** Second line under the name, e.g. an email or a role. Also searched. */
  detail?: string | null;
}

/** Finds matches on the server, for lists too big to hand to the browser. Pass a stable function. */
export type RemoteSearch = (term: string, signal: AbortSignal) => Promise<SearchItem[]>;

interface EntitySearchProps {
  /** The whole list, filtered in the browser. Give this or `search`. */
  items?: SearchItem[];
  /** Custom matching for `items` (e.g. suggestions for words not in the list); defaults to name or detail containing the term. */
  match?: (term: string) => SearchItem[];
  /** Server-side search, called (debounced) as the user types. Give this or `items`. */
  search?: RemoteSearch;
  /** Wait this long after the last keystroke before calling `search`. */
  debounceMs?: number;
  selectedId: string | null;
  /** Shown when the selected id isn't in `items` (e.g. loaded separately, or found by `search`). */
  selectedName?: string | null;
  /** Second line under the selection, e.g. an email. */
  selectedDetail?: string | null;
  onSelect: (item: SearchItem | null) => void;
  placeholder?: string;
  /** The input's accessible name; defaults to the placeholder. */
  ariaLabel?: string;
  /** Shown in the dropdown when a search finds nothing; without it the dropdown just stays closed. */
  emptyText?: string;
  autoFocus?: boolean;
  className?: string;
}

const LOCAL_MATCH_LIMIT = 10;

/**
 * Keyboard and ARIA wiring for the dropdown (the WAI-ARIA combobox pattern): ArrowDown/ArrowUp
 * move through the options (wrapping), Enter picks the highlighted one (or the only one), Escape
 * clears the search. Focus stays in the input; the highlighted option is announced through
 * aria-activedescendant.
 */
function useComboboxKeys({
  count,
  options,
  onPick,
  onEscape,
}: {
  count: number;
  /** The options showing; a different set (a new search) drops the highlight. */
  options: unknown;
  onPick: (index: number) => void;
  /** Return true if Escape did something, so it doesn't also bubble (e.g. closing a modal). */
  onEscape: () => boolean;
}) {
  // The highlight remembers which option set it belongs to, so new results start unhighlighted.
  const [highlight, setHighlight] = useState<{ index: number; options: unknown }>({ index: -1, options });
  const listboxId = useId();
  const optionId = (i: number) => `${listboxId}-${i}`;
  const activeIndex = highlight.options === options ? highlight.index : -1;
  // A stale index (the options shrank) counts as nothing highlighted.
  const active = activeIndex < count ? activeIndex : -1;
  const setActiveIndex = (next: number | ((i: number) => number)) =>
    setHighlight({ index: typeof next === "function" ? next(activeIndex) : next, options });

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      if (count === 0) return;
      e.preventDefault();
      setActiveIndex((i) => (i + 1 >= count ? 0 : i + 1));
    } else if (e.key === "ArrowUp") {
      if (count === 0) return;
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 || i >= count ? count - 1 : i - 1));
    } else if (e.key === "Enter") {
      const index = active >= 0 ? active : count === 1 ? 0 : -1;
      if (index >= 0) {
        e.preventDefault();
        onPick(index);
        setActiveIndex(-1);
      }
    } else if (e.key === "Escape" && onEscape()) {
      e.stopPropagation();
      setActiveIndex(-1);
    }
  };

  return {
    activeIndex: active,
    reset: () => setActiveIndex(-1),
    inputProps: (expanded: boolean) => ({
      role: "combobox" as const,
      "aria-expanded": expanded,
      "aria-controls": listboxId,
      "aria-autocomplete": "list" as const,
      "aria-activedescendant": expanded && active >= 0 ? optionId(active) : undefined,
      onKeyDown,
    }),
    listboxProps: { id: listboxId, role: "listbox" as const },
    optionProps: (i: number) => ({
      id: optionId(i),
      role: "option" as const,
      "aria-selected": i === active,
      // Keep focus in the input so the dropdown doesn't close before the click lands.
      onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
      onMouseEnter: () => setActiveIndex(i),
    }),
  };
}

/** Debounced server search: results for the current term, plus loading/error state. */
function useRemoteResults(search: RemoteSearch | undefined, term: string, debounceMs: number) {
  const [results, setResults] = useState<SearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!search || !term) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const found = await search(term, controller.signal);
        if (controller.signal.aborted) return;
        setResults(found);
      } catch (err) {
        if (controller.signal.aborted) return;
        setResults([]);
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, term, debounceMs]);

  return { results, loading, error };
}

/**
 * Reusable single-select search/autocomplete: shows the selection with a clear button, or a
 * search input with a dropdown of matches, navigable with the arrow keys, Enter and Escape.
 * Matches come from `items` filtered in the browser, or from `search` on the server.
 * MemberSearch, StaffSearch, SudoMemberSearch and the check-in's feeling search (EmotionPicker)
 * are thin wrappers around it.
 */
export default function EntitySearch({
  items,
  match,
  search,
  debounceMs = 250,
  selectedId,
  selectedName,
  selectedDetail,
  onSelect,
  placeholder = "Search...",
  ariaLabel,
  emptyText,
  autoFocus,
  className = "",
}: EntitySearchProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const { isFocused, setIsFocused, onFocus, onBlur } = useBlurDelay();
  const inputRef = useRef<HTMLInputElement>(null);
  const term = searchTerm.trim();

  const selected = selectedId ? items?.find((i) => i.id === selectedId) : null;
  const displayName = selected?.name || selectedName;

  const needle = term.toLowerCase();
  const localMatches = !term
    ? []
    : match
      ? match(term).slice(0, LOCAL_MATCH_LIMIT)
      : (items ?? [])
          .filter((i) => i.name.toLowerCase().includes(needle) || i.detail?.toLowerCase().includes(needle))
          .slice(0, LOCAL_MATCH_LIMIT);

  const remote = useRemoteResults(search, term, debounceMs);
  const matches = search ? remote.results : localMatches;

  // A server search shows its progress and failures; any search can say it found nothing.
  const loading = !!search && !!term && remote.loading && matches.length === 0;
  const failed = !!search && !!term && !!remote.error;
  const empty = !!emptyText && !!term && matches.length === 0 && !failed && !(search && remote.loading);
  const showList = matches.length > 0 && !failed;
  const showDropdown = isFocused && (showList || loading || failed || empty);

  function handleSelect(item: SearchItem | null) {
    onSelect(item);
    setSearchTerm("");
    setIsFocused(false);
    // After clearing a selection, put the cursor back in the search box.
    if (item === null) setTimeout(() => inputRef.current?.focus(), 0);
  }

  const combobox = useComboboxKeys({
    count: isFocused && showList ? matches.length : 0,
    // Server results are a new array only when they arrive; local matches are keyed by the term.
    options: search ? remote.results : term,
    onPick: (i) => handleSelect(matches[i]),
    onEscape: () => {
      if (!searchTerm) return false;
      setSearchTerm("");
      return true;
    },
  });

  if (displayName && !isFocused) {
    return (
      <div className={className}>
        <div className="flex items-center justify-between px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-sm text-slate-900 dark:text-slate-100">
          <div className="flex-1 min-w-0">
            <div className={`truncate ${selectedDetail ? "font-medium" : ""}`}>{displayName}</div>
            {selectedDetail && <div className="truncate text-xs text-slate-600 dark:text-slate-400">{selectedDetail}</div>}
          </div>
          <button
            data-track="entity-search-select"
            type="button"
            onClick={() => handleSelect(null)}
            className="ml-2 text-gray-400 hover:text-gray-600 dark:text-slate-400 dark:hover:text-slate-300"
            title="Clear selection"
            aria-label="Clear selection"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        value={searchTerm}
        onChange={(e) => {
          setSearchTerm(e.target.value);
          combobox.reset();
        }}
        onFocus={onFocus}
        onBlur={onBlur}
        autoFocus={autoFocus}
        aria-label={ariaLabel ?? placeholder}
        {...combobox.inputProps(isFocused && showList)}
        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-plum-500"
      />
      {showDropdown && (
        // No text recorded by analytics: the options are often people.
        <div
          data-track-no-text
          className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg max-h-60 overflow-y-auto"
        >
          {loading ? (
            <div className="px-3 py-2 text-sm text-slate-600 dark:text-slate-400" role="status">
              Searching...
            </div>
          ) : failed ? (
            <div className="px-3 py-2 text-sm text-red-600 dark:text-red-400" role="alert">
              {remote.error}
            </div>
          ) : empty ? (
            <div className="px-3 py-2 text-sm text-slate-600 dark:text-slate-400">{emptyText}</div>
          ) : (
            <ul {...combobox.listboxProps} aria-busy={search ? remote.loading : undefined}>
              {matches.map((item, i) => (
                <li
                  data-track="entity-search-pick"
                  key={item.id}
                  {...combobox.optionProps(i)}
                  onClick={() => handleSelect(item)}
                  className={`cursor-pointer px-3 py-2 text-left border-b border-slate-100 dark:border-slate-700 last:border-b-0 ${
                    i === combobox.activeIndex ? "bg-gray-100 dark:bg-slate-700" : "hover:bg-gray-100 dark:hover:bg-slate-700"
                  }`}
                >
                  <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">{item.name}</div>
                  {item.detail && <div className="text-xs text-gray-600 dark:text-slate-400">{item.detail}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
