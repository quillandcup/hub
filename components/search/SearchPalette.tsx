"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { searchPalette, type PaletteSearch } from "@/app/actions/search";
import { KIND_GLYPHS, formatHitDate } from "@/lib/search/format";
import { KIND_LABELS, type SearchHit } from "@/lib/search/kinds";
import { SEARCH_KINDS, matchWords, parseUniversal, withKind } from "@/lib/search/syntax";
import Highlight from "@/components/search/Highlight";

const RECENTS_KEY = "hub:recent-searches";
const MAX_RECENTS = 5;
const DEBOUNCE_MS = 150;
const MIN_QUERY_CHARS = 2;

/** Operators offered as chips under the input; clicking one types it for you. */
const CHIPS = ["in:", "from:me", "has:link", "after:", "channel:"];
const ADMIN_CHIPS = ["email:", "status:"];

function readRecents(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

function saveRecent(query: string) {
  const q = query.trim();
  if (!q) return;
  try {
    const next = [q, ...readRecents().filter((r) => r !== q)].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Private windows and blocked storage just forget recents.
  }
}

const SearchIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <circle cx="9" cy="9" r="6" />
    <path d="M14 14l4 4" strokeLinecap="round" />
  </svg>
);

/**
 * The header search: a bar that opens a ⌘K palette with results grouped by kind, operator chips
 * and keyboard navigation. Enter on a highlighted row opens it; Enter otherwise (or "View all
 * results") goes to the full results page. `resultsPath` is that page for the layout it's in.
 */
export default function SearchPalette({ resultsPath, isAdmin }: { resultsPath: string; isAdmin: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [data, setData] = useState<PaletteSearch | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);

  const close = useCallback(() => setOpen(false), []);

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

  useEffect(() => {
    // Reopening keeps the last query; selecting it means typing replaces it, as in Slack.
    if (open) inputRef.current?.select();
  }, [open]);

  // Read each time the palette opens (localStorage, so never on the server: it starts closed).
  const recents = useMemo(() => (open ? readRecents() : []), [open]);

  // Debounced search; a newer keystroke makes an older response stale.
  useEffect(() => {
    if (!open) return;
    const q = input.trim();
    const id = ++requestId.current;
    // An empty box shows no results (see `shown`); bumping the id above drops any answer in flight.
    // One character matches nearly everything, so wait for a second before querying.
    if (q.length < MIN_QUERY_CHARS) return;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const next = await searchPalette(q);
        if (id === requestId.current) {
          setData(next);
          setActive(-1);
        }
      } catch {
        if (id === requestId.current) setData({ results: [] });
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input, open]);

  const query = useMemo(() => parseUniversal(input), [input]);
  const words = useMemo(() => matchWords(query), [query]);
  const typed = input.trim() !== "";
  const shown = input.trim().length >= MIN_QUERY_CHARS ? data : null;
  const busy = loading && typed;
  const hits = useMemo(() => (shown?.results ?? []).flatMap((r) => r.hits), [shown]);
  const resultsHref = `${resultsPath}?q=${encodeURIComponent(input.trim())}`;

  // `in:` followed by letters offers the kinds that start with them.
  const kindMatch = /(?:^|\s)in:([a-z]*)$/i.exec(input);
  const kindSuggestions = kindMatch ? SEARCH_KINDS.filter((k) => k.startsWith(kindMatch[1].toLowerCase())) : [];

  const addToInput = (text: string) => {
    setInput((cur) => `${cur.trim()}${cur.trim() ? " " : ""}${text}`);
    inputRef.current?.focus();
  };

  const acceptKind = (kind: string) => {
    setInput((cur) => cur.replace(/in:[a-z]*$/i, `in:${kind} `));
    inputRef.current?.focus();
  };

  const go = (href: string) => {
    saveRecent(input);
    close();
    router.push(href);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === "Tab" && kindSuggestions.length > 0) {
      e.preventDefault();
      acceptKind(kindSuggestions[0]);
    } else if (e.key === "Enter" && input.trim()) {
      e.preventDefault();
      go(active >= 0 && hits[active] ? hits[active].href : resultsHref);
    }
  };

  let flatIndex = -1;
  const chips = isAdmin ? [...CHIPS, ...ADMIN_CHIPS] : CHIPS;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-10 md:ml-0 mr-auto flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 sm:w-80"
        aria-label="Search"
        aria-keyshortcuts="Meta+K Control+K"
      >
        <SearchIcon className="h-4 w-4 flex-shrink-0" />
        <span className="hidden sm:inline flex-1 truncate text-left">Search members, prickles, chat…</span>
        <kbd className="hidden sm:inline rounded border border-slate-300 dark:border-slate-600 px-1.5 text-xs">⌘K</kbd>
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 sm:p-4 sm:pt-[10vh]" onClick={close}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            className="flex h-dvh w-full max-w-2xl flex-col overflow-hidden bg-white sm:h-auto sm:max-h-[75vh] sm:rounded-xl dark:bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 px-4 py-3">
              <SearchIcon className={`h-5 w-5 flex-shrink-0 text-slate-400 ${busy ? "animate-pulse" : ""}`} />
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Search across members, prickles, projects, books, awards, events and chat"
                className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-slate-400"
                aria-label="Search"
                autoComplete="off"
                spellCheck={false}
              />
              {input && (
                <button type="button" onClick={() => { setInput(""); inputRef.current?.focus(); }} className="text-slate-400 hover:text-slate-600" aria-label="Clear search">
                  ×
                </button>
              )}
              <button
                type="button"
                onClick={close}
                className="sm:hidden flex-shrink-0 rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1 text-sm text-slate-600 dark:text-slate-300"
                aria-label="Close search"
              >
                Esc
              </button>
            </div>

            <div className="flex gap-2 overflow-x-auto sm:flex-wrap border-b border-slate-200 dark:border-slate-800 px-4 py-2">
              {chips.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => addToInput(chip)}
                  className="flex-shrink-0 whitespace-nowrap rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 sm:px-2 sm:py-0.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {chip}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto" aria-live="polite">
              {kindSuggestions.length > 0 && (
                <div className="border-b border-slate-200 dark:border-slate-800 px-4 py-2 text-sm">
                  <span className="text-slate-500">Only search </span>
                  {kindSuggestions.map((k, i) => (
                    <button key={k} type="button" onClick={() => acceptKind(k)} className="mr-2 rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5">
                      in:{k}
                      {i === 0 && <span className="ml-1 text-xs text-slate-400">Tab</span>}
                    </button>
                  ))}
                </div>
              )}

              {!input.trim() && (
                <div className="px-4 py-3 text-sm">
                  {recents.length > 0 ? (
                    <>
                      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Recent searches</div>
                      {recents.map((r) => (
                        <button key={r} type="button" onClick={() => setInput(r)} className="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800">
                          {r}
                        </button>
                      ))}
                    </>
                  ) : (
                    <p className="text-slate-500">
                      Try <code>in:members cody</code>, <code>from:me in:chat</code> or <code>in:books after:2026</code>.
                    </p>
                  )}
                </div>
              )}

              {shown?.unknownKind && kindSuggestions.length === 0 && (
                <p className="px-4 py-3 text-sm text-slate-500">
                  Can’t search “{shown.unknownKind}”. You can search {SEARCH_KINDS.map((k) => KIND_LABELS[k]).join(", ")}, for example in:members.
                </p>
              )}

              {shown && !shown.unknownKind && shown.results.length === 0 && !busy && (
                <p className="px-4 py-6 text-sm text-slate-500">Nothing matches “{input.trim()}”.</p>
              )}

              {shown?.results.map((group) => (
                <section key={group.kind} className="border-b border-slate-100 dark:border-slate-800 py-2 last:border-b-0">
                  <div className="flex items-center justify-between px-4 pb-1">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{KIND_LABELS[group.kind]}</h3>
                    {group.hasMore && (
                      <Link
                        href={`${resultsPath}?q=${encodeURIComponent(withKind(input.trim(), group.kind))}`}
                        onClick={() => { saveRecent(input); close(); }}
                        className="text-xs text-plum-700 dark:text-plum-300 hover:underline"
                      >
                        Show more
                      </Link>
                    )}
                  </div>
                  {group.hits.map((hit) => {
                    flatIndex++;
                    return <HitRow key={`${hit.kind}:${hit.id}`} hit={hit} words={words} active={flatIndex === active} onOpen={() => { saveRecent(input); close(); }} />;
                  })}
                </section>
              ))}

              {shown?.chatSkipped && !shown.unknownKind && (
                <Link
                  href={`${resultsPath}?q=${encodeURIComponent(withKind(input.trim(), "chat"))}`}
                  onClick={() => { saveRecent(input); close(); }}
                  className="block px-4 py-3 text-sm text-plum-700 dark:text-plum-300 hover:underline"
                >
                  Search chat messages for “{input.trim()}”
                </Link>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 px-4 py-2 text-sm">
              {input.trim() ? (
                <Link href={resultsHref} onClick={() => { saveRecent(input); close(); }} className="font-medium text-plum-700 dark:text-plum-300 hover:underline">
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
      className={`flex items-center gap-3 px-4 py-3 sm:py-2 text-sm ${active ? "bg-slate-100 dark:bg-slate-800" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"}`}
      aria-current={active || undefined}
    >
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300">
        {KIND_GLYPHS[hit.kind]}
      </span>
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
