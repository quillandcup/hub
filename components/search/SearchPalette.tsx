"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import * as Sentry from "@sentry/nextjs";
import { markSuggestionsRead, searchPalette, searchSuggestions, suggestOperatorValues, type PaletteSearch, type Suggestion } from "@/app/actions/search";
import { applyCompletion, completionContext, isServerOperator, staticOptions, type CompletionOption } from "@/lib/search/completion";
import { KIND_GLYPHS, formatHitDate } from "@/lib/search/format";
import { KIND_LABELS, type SearchHit } from "@/lib/search/kinds";
import { TITLE_TEMPLATE } from "@/lib/page-title";
import {
  FILTERS_ON_KEY, HISTORY_ON_KEY, isTrackablePlace, readFlag, readPlaces, readSearches, removeSearch, saveSearch, savePlace, writeFlag, type Place,
} from "@/lib/search/recents";
import { SEARCH_KINDS, matchWords, parseUniversal, withKind } from "@/lib/search/syntax";
import Highlight from "@/components/search/Highlight";
import SearchSpinner from "@/components/search/SearchSpinner";

const DEBOUNCE_MS = 150;
const MIN_QUERY_CHARS = 2;
const PLACES_SHOWN = 5;

/** One-click filters. `inline` ones are always chips in the bar; the rest are first in "+" and show as a chip while on. */
const QUICK_CHIPS: { label: string; token: () => string; chatOnly?: boolean; inline?: boolean }[] = [
  { label: "From me", token: () => "from:me", inline: true },
  { label: "Has a link", token: () => "has:link", chatOnly: true },
  { label: "Threads only", token: () => "is:thread", chatOnly: true },
];

/** Operators in the "+" menu: what they find, and the text they start. */
const MORE_OPTIONS: { label: string; token: string; adminOnly?: boolean }[] = [
  { label: "From someone", token: "from:" },
  { label: "In channel", token: "channel:" },
  { label: "Message has", token: "has:" },
  { label: "Message is", token: "is:" },
  { label: "Date", token: "during:" },
  { label: "Member email", token: "email:", adminOnly: true },
  { label: "Membership status", token: "status:", adminOnly: true },
];

/** The "Any time" dropdown: how many days back each choice reaches. */
const TIME_RANGES = [
  { days: 1, label: "Past 24 hours" },
  { days: 7, label: "Past 7 days" },
  { days: 30, label: "Past 30 days" },
];

/** YYYY-MM-DD for `daysAgo` days before today, in the browser's own timezone. */
function localDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const stripSiteTitle = (title: string) => {
  const suffix = TITLE_TEMPLATE.replace("%s", "");
  return (title.endsWith(suffix) ? title.slice(0, -suffix.length) : title).trim();
};

/** A short badge for a visited page, by where it lives. */
function placeGlyph(href: string): string {
  const parts = href.split("/").filter(Boolean);
  const first = parts[0] === "admin" ? parts[1] : parts[0];
  const glyphs: Record<string, string> = {
    chat: "#", members: "Me", prickles: "Pr", "my-prickles": "Pr", projects: "Pj", events: "Ev", bookshelf: "Bk", settings: "⚙", notifications: "!",
  };
  return glyphs[first ?? ""] ?? "Pg";
}

const SearchIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <circle cx="9" cy="9" r="6" />
    <path d="M14 14l4 4" strokeLinecap="round" />
  </svg>
);

const ClockIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className} aria-hidden="true">
    <circle cx="10" cy="10" r="7.5" />
    <path d="M10 5.5V10l3 2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const FilterIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <path d="M3 5.5h14M6 10h8M8.5 14.5h3" strokeLinecap="round" />
  </svg>
);

const CopyIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className} aria-hidden="true">
    <rect x="7" y="7" width="9" height="10" rx="1.5" />
    <path d="M4 13V4.5A1.5 1.5 0 0 1 5.5 3H12" strokeLinecap="round" />
  </svg>
);

const CheckIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
    <path d="M4.5 10.5l3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const iconButton = "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500";
/** Shown on hover or focus, and always on touch screens, which can't hover. */
const revealOnHover = "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100";

/** A row the keyboard can reach: where Enter goes, or what it does. */
interface NavRow {
  key: string;
  href?: string;
  onSelect?: () => void;
}

/**
 * The header search: a bar that opens a ⌘K palette. Empty, it offers what needs you (open
 * check-ins, unread chat and notifications) and the places you visited last; the clock turns
 * that into your recent searches instead. Typing searches, grouped by kind; typing an operator
 * (`from:`, `in:`, `has:` …) opens its autocomplete; the funnel shows one-click filters, and "+"
 * the rest. Enter on a highlighted row opens it; Enter otherwise (or "View all results") goes to
 * the full results page. `resultsPath` is that page for the layout it's in.
 */
export default function SearchPalette({ resultsPath, isAdmin }: { resultsPath: string; isAdmin: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const valuesRequestId = useRef(0);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [data, setData] = useState<PaletteSearch | null>(null);
  // The query `data` answers; while it differs from what is typed, a search is pending.
  const [answeredFor, setAnsweredFor] = useState("");
  const [active, setActive] = useState<{ key: string; index: number } | null>(null);
  // Read from storage on the client only: neither is rendered until the palette is open.
  const [showFilters, setShowFilters] = useState(() => readFlag(FILTERS_ON_KEY));
  const [historyOn, setHistoryOn] = useState(() => readFlag(HISTORY_ON_KEY));
  const [menuOpen, setMenuOpen] = useState(false);
  const [needsAttention, setNeedsAttention] = useState<Suggestion[]>([]);
  const [values, setValues] = useState<{ key: string; options: CompletionOption[] } | null>(null);
  // Bumped after the stored lists change, so they are read again.
  const [storeVersion, setStoreVersion] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setMenuOpen(false);
  }, []);

  // ⌘K / Ctrl+K toggles; "/" opens when you aren't typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Opening: reopening keeps the last query, selected so typing replaces it (as in Slack), and
  // asks what needs the member (it changes between visits, so never cached).
  useEffect(() => {
    if (!open) return;
    inputRef.current?.select();
    let current = true;
    searchSuggestions().then(
      (s) => current && setNeedsAttention(s.needsAttention),
      () => current && setNeedsAttention([])
    );
    return () => {
      current = false;
    };
  }, [open]);

  // Remember the pages visited, for "Recent places". The title is read a beat after the route
  // changes, once Next has set it.
  useEffect(() => {
    if (!isTrackablePlace(pathname)) return;
    const timer = setTimeout(() => {
      savePlace({ href: pathname, title: stripSiteTitle(document.title) });
      setStoreVersion((v) => v + 1);
    }, 500);
    return () => clearTimeout(timer);
  }, [pathname]);

  // Read each time the palette opens or a list changes (localStorage, so never on the server: it starts closed).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recents = useMemo(() => (open ? readSearches() : []), [open, storeVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const places = useMemo(() => (open ? readPlaces().filter((p) => p.href !== pathname).slice(0, PLACES_SHOWN) : []), [open, storeVersion, pathname]);

  const trimmed = input.trim();
  const completion = useMemo(() => completionContext(input), [input]);
  const completionKey = completion ? `${completion.operator}:${completion.typed}` : "";

  // Debounced search; a newer keystroke makes an older response stale.
  useEffect(() => {
    if (!open) return;
    const q = input.trim();
    const id = ++requestId.current;
    // An empty box shows no results (see `shown`); bumping the id above drops any answer in flight.
    // One character matches nearly everything, so wait for a second before querying.
    if (q.length < MIN_QUERY_CHARS) return;
    const timer = setTimeout(async () => {
      try {
        const sent = performance.now();
        const next = await searchPalette(q);
        // What the member waits for: the server action's round trip, network included.
        Sentry.metrics.distribution("search.duration", Math.round(performance.now() - sent), {
          unit: "millisecond",
          attributes: { surface: "palette", stage: "roundtrip" },
        });
        if (id === requestId.current) {
          setData(next);
          setAnsweredFor(q);
        }
      } catch {
        if (id === requestId.current) {
          setData({ results: [] });
          setAnsweredFor(q);
        }
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input, open]);

  // Members and channels for `from:` and `channel:`, as they are typed.
  useEffect(() => {
    if (!open || !completion || !isServerOperator(completion.operator)) return;
    const id = ++valuesRequestId.current;
    const { operator, typed } = completion;
    const key = `${operator}:${typed}`;
    const timer = setTimeout(async () => {
      try {
        const options = await suggestOperatorValues(operator, typed);
        if (id === valuesRequestId.current) setValues({ key, options });
      } catch {
        if (id === valuesRequestId.current) setValues({ key, options: [] });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completionKey, open]);

  const parsed = useMemo(() => parseUniversal(input), [input]);
  const words = useMemo(() => matchWords(parsed), [parsed]);
  // Link and thread filters only apply to chat messages, so they're offered when chat is in play.
  const chatInPlay = !parsed.kind || parsed.kind === "chat";
  const shown = trimmed.length >= MIN_QUERY_CHARS ? data : null;
  // True from the keystroke (not just once the request is sent) until its answer arrives, so the
  // debounce gap and the server round trip both read as "searching".
  const busy = trimmed.length >= MIN_QUERY_CHARS && answeredFor !== trimmed;
  const hits = useMemo(() => (shown?.results ?? []).flatMap((r) => r.hits), [shown]);
  const resultsHref = `${resultsPath}?q=${encodeURIComponent(trimmed)}`;

  // Autocomplete for the operator being typed: fixed lists here, members and channels from the
  // server (null until they arrive).
  const options = useMemo<CompletionOption[] | null>(() => {
    if (!completion) return null;
    if (isServerOperator(completion.operator)) return values?.key === completionKey ? values.options : null;
    return staticOptions(completion, new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completion, completionKey, values]);
  const completing = !!completion && (options === null ? isServerOperator(completion.operator) : options.length > 0);

  const mode: "completion" | "history" | "home" | "results" = completing ? "completion" : !trimmed ? (historyOn ? "history" : "home") : "results";

  const addToInput = (text: string) => {
    setInput((cur) => `${cur.trim()}${cur.trim() ? " " : ""}${text}`);
    inputRef.current?.focus();
  };

  const tokens = trimmed.split(/\s+/);
  const toggleToken = (token: string) => {
    if (tokens.includes(token)) setInput(tokens.filter((t) => t !== token).join(" "));
    else addToInput(token);
    inputRef.current?.focus();
  };

  // "Any time": swaps whatever after: filter is there for the chosen range, or clears it.
  const afterToken = tokens.find((t) => /^after:\S+$/i.test(t));
  const timeRange = TIME_RANGES.find((r) => afterToken === `after:${localDate(r.days)}`);
  const setTimeRange = (days: string) => {
    const rest = tokens.filter((t) => t && t !== afterToken);
    setInput((days ? [...rest, `after:${localDate(Number(days))}`] : rest).join(" "));
    inputRef.current?.focus();
  };

  // Takes one row off the list at once; the server marks it read (a check-in or check-out is
  // dismissed, a notification read) so it leaves every other list too. Chat rows have no x: reading
  // a conversation is a bigger step than clearing it from this list.
  const dismissSuggestion = (s: Suggestion) => {
    setNeedsAttention((cur) => cur.filter((x) => x.id !== s.id));
    markSuggestionsRead([s.id]).catch(() => {});
    inputRef.current?.focus();
  };

  const accept = (option: CompletionOption) => {
    if (!completion) return;
    setInput((cur) => applyCompletion(cur, completion, option));
    inputRef.current?.focus();
  };

  const go = (href: string) => {
    saveSearch(input);
    close();
    router.push(href);
  };

  const toggleFilters = () => {
    const next = !showFilters;
    setShowFilters(next);
    if (!next) setMenuOpen(false);
    writeFlag(FILTERS_ON_KEY, next);
    inputRef.current?.focus();
  };

  const toggleHistory = () => {
    const next = !historyOn;
    setHistoryOn(next);
    writeFlag(HISTORY_ON_KEY, next);
    inputRef.current?.focus();
  };

  const deleteRecent = (query: string) => {
    removeSearch(query);
    setStoreVersion((v) => v + 1);
    inputRef.current?.focus();
  };

  const copyRecent = async (query: string) => {
    try {
      await navigator.clipboard.writeText(query);
      setCopied(query);
      setTimeout(() => setCopied((c) => (c === query ? null : c)), 1500);
    } catch {
      // No clipboard access: nothing to confirm.
    }
  };

  // What the arrow keys walk, and what Enter does on it.
  const rows = useMemo<NavRow[]>(() => {
    if (mode === "completion") return (options ?? []).map((o) => ({ key: o.value, onSelect: () => accept(o) }));
    if (mode === "history") return recents.map((r) => ({ key: r, onSelect: () => setInput(r) }));
    if (mode === "home") return [...needsAttention.map((s) => ({ key: s.id, href: s.href })), ...places.map((p) => ({ key: `place:${p.href}`, href: p.href }))];
    return hits.map((h) => ({ key: `${h.kind}:${h.id}`, href: h.href }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, options, recents, needsAttention, places, hits, completion]);

  // The highlighted row belongs to one view of the list; a new list starts over (the first
  // autocomplete choice is pre-selected so Enter takes it, as in Slack).
  const listKey = `${mode}|${trimmed}|${answeredFor}|${rows.length}`;
  const activeIndex = active?.key === listKey ? active.index : mode === "completion" ? 0 : -1;
  const moveActive = (to: (index: number) => number) => setActive({ key: listKey, index: Math.max(-1, Math.min(rows.length - 1, to(activeIndex))) });

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (menuOpen) setMenuOpen(false);
      else close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive((i) => i + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive((i) => i - 1);
    } else if (e.key === "Tab" && mode === "completion" && rows.length > 0) {
      e.preventDefault();
      rows[Math.max(activeIndex, 0)].onSelect?.();
    } else if (e.key === "Enter") {
      const row = rows[activeIndex];
      if (row?.onSelect) {
        e.preventDefault();
        row.onSelect();
      } else if (row?.href) {
        e.preventDefault();
        go(row.href);
      } else if (trimmed) {
        e.preventDefault();
        go(resultsHref);
      }
    }
  };

  let flatIndex = -1;
  const moreOptions = MORE_OPTIONS.filter((o) => isAdmin || !o.adminOnly);
  const quickFilters = QUICK_CHIPS.filter((c) => !c.chatOnly || chatInPlay);
  // Inline ones are always chips; any other that's on is one too, so it can be turned off without opening "+".
  const barQuick = quickFilters.filter((c) => c.inline || tokens.includes(c.token()));
  const menuQuick = quickFilters.filter((c) => !c.inline);
  const completionTitle = completion?.operator === "from" ? "People" : completion?.operator === "channel" ? "Channels" : `${completion?.operator}:`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-10 md:ml-0 mr-auto flex h-10 items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-sm text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 sm:w-80 lg:w-[28rem] xl:w-[36rem]"
        aria-label="Search"
        aria-keyshortcuts="Meta+K Control+K"
      >
        <SearchIcon className="h-4 w-4 flex-shrink-0" />
        <span className="hidden sm:inline flex-1 truncate text-left">Search pages, members, chat…</span>
        <kbd className="hidden sm:inline rounded border border-slate-300 dark:border-slate-600 px-1.5 text-xs">⌘K</kbd>
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 sm:p-4 sm:pt-[10vh]" onClick={close}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            className="flex h-dvh w-full max-w-3xl flex-col overflow-hidden bg-white sm:h-auto sm:max-h-[75vh] sm:rounded-xl dark:bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 px-4 py-3">
              <SearchIcon className={`h-5 w-5 flex-shrink-0 text-slate-400 ${busy ? "animate-pulse" : ""}`} />
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Search pages, channels, members, prickles, projects, books, awards, events and chat"
                className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-slate-400"
                aria-label="Search"
                autoComplete="off"
                spellCheck={false}
              />
              {input && (
                <button type="button" onClick={() => { setInput(""); inputRef.current?.focus(); }} className="flex-shrink-0 px-1 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={toggleFilters}
                aria-pressed={showFilters}
                aria-label={showFilters ? "Hide filters" : "Show filters"}
                title={showFilters ? "Hide filters" : "Show filters"}
                className={`${iconButton} ${showFilters ? "bg-plum-100 text-plum-700 dark:bg-plum-900/40 dark:text-plum-300" : ""}`}
              >
                <FilterIcon className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={toggleHistory}
                aria-pressed={historyOn}
                aria-label={historyOn ? "Hide search history" : "Show search history"}
                title={historyOn ? "Hide search history" : "Show search history"}
                className={`${iconButton} ${historyOn ? "bg-plum-100 text-plum-700 dark:bg-plum-900/40 dark:text-plum-300" : ""}`}
              >
                <ClockIcon className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={close}
                className="sm:hidden flex-shrink-0 rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1 text-sm text-slate-600 dark:text-slate-300"
                aria-label="Close search"
              >
                Esc
              </button>
            </div>

            {showFilters && (
              <div className="border-b border-slate-200 dark:border-slate-800">
                <div className="flex flex-wrap gap-1.5 px-4 py-2">
                  <select
                    aria-label="Search in"
                    value={parsed.kind ?? ""}
                    onChange={(e) => setInput((cur) => withKind(cur, (e.target.value || undefined) as Parameters<typeof withKind>[1]))}
                    className={`rounded-md border bg-transparent px-2 py-1.5 sm:py-1 text-xs ${parsed.kind ? "border-plum-500 bg-plum-50 text-plum-700 dark:bg-plum-900/30 dark:text-plum-300" : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"}`}
                  >
                    <option value="">Everything</option>
                    {SEARCH_KINDS.map((k) => (
                      <option key={k} value={k}>{KIND_LABELS[k]}</option>
                    ))}
                  </select>
                  {barQuick.map((chip) => {
                    const on = tokens.includes(chip.token());
                    return (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => toggleToken(chip.token())}
                        aria-pressed={on}
                        className={`flex-shrink-0 whitespace-nowrap rounded-md border px-2.5 py-1.5 sm:px-2 sm:py-1 text-xs ${on ? "border-plum-500 bg-plum-50 text-plum-700 dark:bg-plum-900/30 dark:text-plum-300" : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"}`}
                      >
                        {chip.label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => addToInput("from:")}
                    className="flex-shrink-0 whitespace-nowrap rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 sm:px-2 sm:py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    From…
                  </button>
                  <select
                    aria-label="Time range"
                    value={timeRange ? String(timeRange.days) : afterToken ? "custom" : ""}
                    onChange={(e) => setTimeRange(e.target.value)}
                    className={`rounded-md border bg-transparent px-2 py-1.5 sm:py-1 text-xs ${afterToken ? "border-plum-500 bg-plum-50 text-plum-700 dark:bg-plum-900/30 dark:text-plum-300" : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"}`}
                  >
                    <option value="">Any time</option>
                    {TIME_RANGES.map((r) => (
                      <option key={r.days} value={r.days}>{r.label}</option>
                    ))}
                    {afterToken && !timeRange && <option value="custom" disabled>{afterToken.replace(/^after:/i, "Since ")}</option>}
                  </select>
                  <button
                    type="button"
                    onClick={() => setMenuOpen((m) => !m)}
                    aria-expanded={menuOpen}
                    aria-label="More filters"
                    title="More filters"
                    className="flex-shrink-0 rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 sm:px-2 sm:py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    +
                  </button>
                </div>
                {menuOpen && (
                  <div className="border-t border-slate-100 dark:border-slate-800 px-4 py-2 text-sm">
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">More options</div>
                    {menuQuick.map((chip) => {
                      const token = chip.token();
                      const on = tokens.includes(token);
                      return (
                        <button
                          key={chip.label}
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={on}
                          onClick={() => { toggleToken(token); setMenuOpen(false); }}
                          className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <span>{chip.label}</span>
                          <span className="text-xs text-plum-600 dark:text-plum-300">{on ? "On" : token}</span>
                        </button>
                      );
                    })}
                    {moreOptions.map((o) => (
                      <button
                        key={o.token}
                        type="button"
                        onClick={() => { addToInput(o.token); setMenuOpen(false); }}
                        className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span>{o.label}</span>
                        <span className="text-xs text-slate-400">{o.token}</span>
                      </button>
                    ))}
                    {(["after", "before"] as const).map((op) => (
                      <label key={op} className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800">
                        <span>{op === "after" ? "After date" : "Before date"}</span>
                        <input
                          type="date"
                          aria-label={op === "after" ? "After date" : "Before date"}
                          onChange={(e) => {
                            if (!e.target.value) return;
                            addToInput(`${op}:${e.target.value}`);
                            setMenuOpen(false);
                          }}
                          className="rounded border border-slate-300 dark:border-slate-600 bg-transparent px-1 py-0.5 text-xs"
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {busy && <div className="h-0.5 w-full animate-pulse bg-plum-500" aria-hidden="true" />}

            <div className="flex-1 overflow-y-auto" aria-live="polite">
              {busy && mode === "results" && <SearchSpinner className="px-4 py-3" />}

              {mode === "completion" && (
                <section className="py-2">
                  <h3 className="px-4 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{completionTitle}</h3>
                  {options === null && <SearchSpinner className="px-4 py-2" />}
                  {(options ?? []).map((o, i) => (
                    <Row
                      key={o.value}
                      active={i === activeIndex}
                      onClick={() => accept(o)}
                      icon={
                        o.imageUrl
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={o.imageUrl} alt="" className="h-8 w-8 rounded-md object-cover" />
                          : <Glyph>{(o.label[0] ?? "").toUpperCase()}</Glyph>
                      }
                      title={o.label}
                      subtitle={o.sublabel}
                    />
                  ))}
                </section>
              )}

              {mode === "history" && (
                <section className="py-2">
                  <h3 className="px-4 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Recent searches</h3>
                  {recents.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">Your searches will show up here.</p>}
                  {recents.map((r, i) => (
                    <div
                      key={r}
                      className={`group flex items-center gap-1 pr-2 ${i === activeIndex ? "bg-slate-100 dark:bg-slate-800" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"}`}
                    >
                      <button type="button" onClick={() => setInput(r)} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 sm:py-2 text-left text-sm">
                        <ClockIcon className="h-5 w-5 flex-shrink-0 text-slate-400" />
                        <span className="min-w-0 flex-1 truncate">{r}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => copyRecent(r)}
                        title={copied === r ? "Copied" : "Copy search query"}
                        aria-label={`Copy search query “${r}”`}
                        className={`${iconButton} ${revealOnHover}`}
                      >
                        {copied === r ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRecent(r)}
                        title="Delete"
                        aria-label={`Delete “${r}” from recent searches`}
                        className={`${iconButton} ${revealOnHover}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </section>
              )}

              {mode === "home" && (
                <>
                  {needsAttention.length > 0 && (
                    <section className="py-2">
                      <h3 className="px-4 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Needs attention</h3>
                      {needsAttention.map((s) => {
                        flatIndex++;
                        return (
                          <div key={s.id} className="group flex items-center pr-2">
                            <div className="min-w-0 flex-1">
                            <Row
                              active={flatIndex === activeIndex}
                              href={s.href}
                              onOpen={close}
                              icon={<Glyph>{s.kind === "checkin" ? "✓" : s.kind === "chat" ? "#" : "!"}</Glyph>}
                              title={s.title}
                              subtitle={s.subtitle}
                              right={s.count ? <span className="rounded-full bg-plum-600 px-2 py-0.5 text-xs font-medium text-white">{s.count}</span> : undefined}
                            />
                            </div>
                            {s.kind !== "chat" && (
                              <button
                                type="button"
                                onClick={() => dismissSuggestion(s)}
                                title="Mark as read"
                                aria-label={`Mark “${s.title}” as read`}
                                className={`${iconButton} ${revealOnHover}`}
                              >
                                ×
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </section>
                  )}
                  {places.length > 0 && (
                    <section className="border-t border-slate-100 dark:border-slate-800 py-2 first:border-t-0">
                      <h3 className="px-4 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Recent places</h3>
                      {places.map((p: Place) => {
                        flatIndex++;
                        return <Row key={p.href} active={flatIndex === activeIndex} href={p.href} onOpen={close} icon={<Glyph>{placeGlyph(p.href)}</Glyph>} title={p.title} />;
                      })}
                    </section>
                  )}
                  {needsAttention.length === 0 && places.length === 0 && (
                    <p className="px-4 py-3 text-sm text-slate-500">
                      Try <code>in:members cody</code>, <code>from:me in:chat</code> or <code>in:books after:2026</code>.
                    </p>
                  )}
                </>
              )}

              {mode === "results" && (
                <>
                  {shown?.unknownKind && (
                    <p className="px-4 py-3 text-sm text-slate-500">
                      Can’t search “{shown.unknownKind}”. You can search {SEARCH_KINDS.map((k) => KIND_LABELS[k]).join(", ")}, for example in:members.
                    </p>
                  )}

                  {shown && !shown.unknownKind && shown.results.length === 0 && !busy && (
                    <p className="px-4 py-6 text-sm text-slate-500">Nothing matches “{trimmed}”.</p>
                  )}

                  {shown?.results.map((group) => (
                    <section key={group.kind} className={`border-b border-slate-100 dark:border-slate-800 py-2 last:border-b-0 ${busy ? "opacity-50" : ""}`}>
                      <div className="flex items-center justify-between px-4 pb-1">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{KIND_LABELS[group.kind]}</h3>
                        {group.hasMore && (
                          <Link
                            href={`${resultsPath}?q=${encodeURIComponent(withKind(trimmed, group.kind))}`}
                            onClick={() => { saveSearch(input); close(); }}
                            className="text-xs text-plum-700 dark:text-plum-300 hover:underline"
                          >
                            Show more
                          </Link>
                        )}
                      </div>
                      {group.hits.map((hit) => {
                        flatIndex++;
                        return <HitRow key={`${hit.kind}:${hit.id}`} hit={hit} words={words} active={flatIndex === activeIndex} onOpen={() => { saveSearch(input); close(); }} />;
                      })}
                    </section>
                  ))}

                  {shown?.chatSkipped && !shown.unknownKind && (
                    <Link
                      href={`${resultsPath}?q=${encodeURIComponent(withKind(trimmed, "chat"))}`}
                      onClick={() => { saveSearch(input); close(); }}
                      className="block px-4 py-3 text-sm text-plum-700 dark:text-plum-300 hover:underline"
                    >
                      Search chat messages for “{trimmed}”
                    </Link>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 px-4 py-2 text-sm">
              {trimmed ? (
                <Link href={resultsHref} onClick={() => { saveSearch(input); close(); }} className="font-medium text-plum-700 dark:text-plum-300 hover:underline">
                  View all results
                </Link>
              ) : (
                <span className="text-slate-500">Type to search</span>
              )}
              <span className="text-xs text-slate-400">
                {busy ? "Searching…" : <span className="hidden sm:inline">↑↓ to move · Enter to open · Esc to close</span>}
              </span>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** The small square badge at the start of a row. */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300">
      {children}
    </span>
  );
}

/** A suggestion or autocomplete row: a link when it has `href`, otherwise a button that runs `onClick`. */
function Row({
  active, icon, title, subtitle, right, href, onOpen, onClick,
}: {
  active: boolean;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  href?: string;
  onOpen?: () => void;
  onClick?: () => void;
}) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) (linkRef.current ?? buttonRef.current)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const className = `flex w-full items-center gap-3 px-4 py-3 sm:py-2 text-left text-sm ${active ? "bg-slate-100 dark:bg-slate-800" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"}`;
  const body = (
    <>
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {subtitle && <span className="block truncate text-slate-500">{subtitle}</span>}
      </span>
      {right}
      {active && <kbd className="flex-shrink-0 rounded border border-slate-300 dark:border-slate-600 px-1.5 text-xs text-slate-500">Enter</kbd>}
    </>
  );
  return href ? (
    <Link ref={linkRef} href={href} onClick={onOpen} className={className} aria-current={active || undefined}>
      {body}
    </Link>
  ) : (
    <button ref={buttonRef} type="button" onClick={onClick} className={className} aria-current={active || undefined}>
      {body}
    </button>
  );
}

function HitRow({ hit, words, active, onOpen }: { hit: SearchHit; words: string[]; active: boolean; onOpen: () => void }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <Link
      ref={ref}
      href={hit.href}
      onClick={onOpen}
      className={`flex items-center gap-3 px-4 py-3 sm:py-2 text-sm ${hit.muted ? "opacity-60" : ""} ${active ? "bg-slate-100 dark:bg-slate-800" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"}`}
      aria-current={active || undefined}
    >
      <Glyph>{KIND_GLYPHS[hit.kind]}</Glyph>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">
          <Highlight text={hit.title} words={words} />
          {hit.badge && <span className="ml-2 rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-xs font-normal text-slate-500">{hit.badge}</span>}
        </span>
        {hit.subtitle && (
          <span className="block truncate text-slate-500">
            <Highlight text={hit.subtitle} words={words} />
          </span>
        )}
      </span>
      {hit.date && <span className="flex-shrink-0 text-xs text-slate-500">{formatHitDate(hit.date)}</span>}
      {active && <kbd className="flex-shrink-0 rounded border border-slate-300 dark:border-slate-600 px-1.5 text-xs text-slate-500">Enter</kbd>}
    </Link>
  );
}
