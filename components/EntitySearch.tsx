"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBelow } from "@/lib/hooks/useBelow";
import { useBlurDelay } from "@/lib/hooks/useBlurDelay";
import { useComboboxKeys } from "@/lib/hooks/useComboboxKeys";
import { submitFormOnModEnter } from "@/lib/submit-form-on-mod-enter";
import Kbd from "@/components/Kbd";
import { useRegisterShortcuts } from "@/components/shortcuts/ShortcutsProvider";
import Tooltip from "@/components/Tooltip";

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
  /** List `items` as soon as the box is focused, before anything is typed (for a short list worth browsing, like a person's channels). */
  browse?: boolean;
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
/** How many items a `browse` list shows before anything is typed (the dropdown scrolls). */
const BROWSE_LIMIT = 50;

/**
 * The key hints under a dropdown's options (hidden where there is no keyboard, like every `Kbd`). `toggle` says
 * Enter toggles the highlighted option (a multi-select) instead of picking it. Shared with MultiEntitySearch.
 */
export function KeyHints({ toggle }: { toggle: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="sticky bottom-0 hidden fine-pointer:sm:flex items-center gap-3 border-t border-slate-100 bg-white px-3 py-1 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
    >
      <span className="flex items-center gap-1">
        <Kbd keys={["up", "down"]} /> navigate
      </span>
      <span className="flex items-center gap-1">
        <Kbd keys={["enter"]} /> {toggle ? "toggle" : "select"}
      </span>
      <span className="flex items-center gap-1">
        <Kbd keys={["esc"]} /> close
      </span>
    </div>
  );
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
  browse,
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
  // The picker's keys are listed in the `?` panel while one is on the page.
  useRegisterShortcuts("pickers");
  const [searchTerm, setSearchTerm] = useState("");
  const { isFocused, setIsFocused, onFocus, onBlur } = useBlurDelay();
  const inputRef = useRef<HTMLInputElement>(null);
  const term = searchTerm.trim();

  const selected = selectedId ? items?.find((i) => i.id === selectedId) : null;
  const displayName = selected?.name || selectedName;

  const needle = term.toLowerCase();
  const localMatches = !term
    ? browse && !search
      ? (items ?? []).slice(0, BROWSE_LIMIT)
      : []
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
  // Escape closes the list without touching the typed text; typing, focusing or an arrow key brings it back.
  const [dismissed, setDismissed] = useState(false);
  const showDropdown = isFocused && !dismissed && (showList || loading || failed || empty);
  const below = useBelow(inputRef, showDropdown);

  function handleSelect(item: SearchItem | null) {
    onSelect(item);
    setSearchTerm("");
    setIsFocused(false);
    // After clearing a selection, put the cursor back in the search box.
    if (item === null) setTimeout(() => inputRef.current?.focus(), 0);
  }

  const combobox = useComboboxKeys({
    count: isFocused && !dismissed && showList ? matches.length : 0,
    // Server results are a new array only when they arrive; local matches are keyed by the term.
    options: search ? remote.results : term,
    homeEnd: true,
    onPick: (i) => handleSelect(matches[i]),
    // Only an open list takes the Escape, so a second one reaches the modal around the box.
    onEscape: () => {
      if (!showDropdown) return false;
      setDismissed(true);
      return true;
    },
  });

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (submitFormOnModEnter(e)) return;
    if (dismissed && showList && (e.key === "ArrowDown" || e.key === "ArrowUp") && !e.nativeEvent.isComposing) {
      e.preventDefault();
      setDismissed(false);
      return;
    }
    combobox.handleKey(e);
  }

  if (displayName && !isFocused) {
    return (
      <div className={className}>
        <div className="flex items-center justify-between px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-sm text-slate-900 dark:text-slate-100">
          <div className="flex-1 min-w-0">
            <div className={`truncate ${selectedDetail ? "font-medium" : ""}`}>{displayName}</div>
            {selectedDetail && <div className="truncate text-xs text-slate-600 dark:text-slate-400">{selectedDetail}</div>}
          </div>
          <Tooltip content="Clear selection">
            <button
              data-track="entity-search-select"
              type="button"
              onClick={() => handleSelect(null)}
              className="ml-2 text-gray-400 hover:text-gray-600 dark:text-slate-400 dark:hover:text-slate-300"
              aria-label="Clear selection"
            >
              ✕
            </button>
          </Tooltip>
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
          setDismissed(false);
          combobox.reset();
        }}
        onFocus={() => {
          setDismissed(false);
          onFocus();
        }}
        onBlur={onBlur}
        autoFocus={autoFocus}
        aria-label={ariaLabel ?? placeholder}
        {...combobox.inputProps(showDropdown && showList)}
        onKeyDown={onKeyDown}
        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-plum-500"
      />
      {showDropdown && below && createPortal(
        // No text recorded by analytics: the options are often people. On `<body>`, over a modal if the picker is in one.
        <div
          data-track-no-text
          data-entity-search-list
          style={{ top: below.top, left: below.left, width: below.width }}
          // Keeps focus in the box when the footer is clicked.
          onMouseDown={(e) => e.preventDefault()}
          className="fixed z-overlay bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg max-h-60 overflow-y-auto"
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
          {showList && <KeyHints toggle={false} />}
        </div>,
        document.body
      )}
    </div>
  );
}
