"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Emoji } from "@/components/chat/ChatText";
import { track } from "@/lib/analytics/client";
import type { CustomEmoji } from "@/lib/chat/emoji";
import { SKIN_TONES, readTone, withTone, writeTone } from "@/lib/chat/skin-tone";
import {
  CATEGORIES,
  buildCatalog,
  customNames,
  readRecents,
  rememberRecent,
  searchStandard,
  type StandardEntry,
} from "@/lib/chat/emoji-catalog";

type TabId = "recent" | (typeof CATEGORIES)[number]["id"] | "custom";

/** The emoji data is big: fetched when the picker first opens, then kept. */
let catalogPromise: Promise<StandardEntry[]> | null = null;
function loadCatalog(): Promise<StandardEntry[]> {
  catalogPromise ??= Promise.all([import("emojibase-data/en/data.json"), import("emojibase-data/en/shortcodes/iamcal.json")])
    .then(([data, codes]) => buildCatalog(data.default as never, codes.default as never))
    .catch((error) => {
      catalogPromise = null;
      throw error;
    });
  return catalogPromise;
}

/** Names per chunk of a long list; each chunk is skipped by the browser while off screen. */
const CHUNK = 144;
/** Cells per row at the picker's width, only to size a skipped chunk (w-80 less padding, 2rem cells). */
const PER_ROW = 7;

/** What "Frequently used" holds until the member has picked something: the old quick reactions, so first use is not empty. */
export const DEFAULT_FREQUENT = ["thumbsup", "heart", "joy", "tada", "pray", "eyes", "white_check_mark", "raised_hands"];

const CELL = "flex h-10 w-10 items-center justify-center rounded text-xl hover:bg-slate-100 dark:hover:bg-slate-800";

/**
 * The full emoji picker: search, category tabs, a scrollable grid with headings, the member's
 * recent picks and the workspace's custom emoji. `onPick` gets the Slack shortcode.
 */
export default function EmojiPicker({
  custom,
  onPick,
  onClose,
}: {
  custom: Record<string, CustomEmoji>;
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const [catalog, setCatalog] = useState<StandardEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [recents] = useState(() => {
    const own = readRecents();
    return own.length ? own : DEFAULT_FREQUENT;
  });
  const [active, setActive] = useState<TabId>("recent");
  const [tone, setTone] = useState<number | null>(readTone);
  const [roving, setRoving] = useState<string | null>(null);
  const [flip, setFlip] = useState(false);
  const [shift, setShift] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    loadCatalog().then(
      (c) => live && setCatalog(c),
      () => live && setFailed(true)
    );
    input.current?.focus();
    return () => {
      live = false;
    };
  }, []);

  // Opens below its button; above it when the bottom would be cut off and there is room. On a
  // phone it is a bottom sheet instead (CSS), so this only matters from sm up. Nudged sideways
  // when its left edge would fall off the window.
  useLayoutEffect(() => {
    const rect = root.current?.getBoundingClientRect();
    if (!rect) return;
    if (rect.bottom > window.innerHeight && rect.top - rect.height - 40 > 0) setFlip(true);
    if (rect.left < 8) setShift(8 - rect.left);
    else if (rect.right > window.innerWidth - 8) setShift(window.innerWidth - 8 - rect.right);
  }, []);

  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const customList = useMemo(() => customNames(custom), [custom]);
  const byCategory = useMemo(() => {
    const map = new Map<string, StandardEntry[]>();
    for (const e of catalog ?? []) map.set(e.category, [...(map.get(e.category) ?? []), e]);
    return map;
  }, [catalog]);

  const tonable = useMemo(() => new Set((catalog ?? []).filter((e) => e.tonable).map((e) => e.name)), [catalog]);

  const searching = query.trim() !== "";
  const standardHits = useMemo(() => (catalog && searching ? searchStandard(catalog, query) : []), [catalog, query, searching]);
  const customHits = useMemo(() => (searching ? customNames(custom, query) : []), [custom, query, searching]);

  const pick = (name: string, via: "recent" | "browse" | "search") => {
    rememberRecent(name);
    track("chat_reaction_picked", { via, custom: name in custom });
    onPick(name);
  };

  const jump = (id: TabId) => {
    setActive(id);
    setQuery("");
    // After the browse view is back, scroll to the section.
    requestAnimationFrame(() => {
      const section = scroller.current?.querySelector(`[data-section="${id}"]`);
      if (section instanceof HTMLElement) scroller.current!.scrollTop = section.offsetTop - scroller.current!.offsetTop;
    });
  };

  const chooseTone = (next: number | null) => {
    setTone(next);
    writeTone(next);
  };

  // One tab stop for the whole grid: the last focused cell, else the first one drawn.
  let firstCell: string | null = null;
  const cell = (name: string, via: "recent" | "browse" | "search", where: string) => {
    const id = `${where}:${name}`;
    firstCell ??= id;
    // A chosen tone applies to standard emoji that have tone variants (not custom ones or recents, which keep what was picked).
    const shown = via !== "recent" && tonable.has(name) && !(name in custom) ? withTone(name, tone) : name;
    return (
      <button
        key={id}
        type="button"
        data-cell={id}
        aria-label={`React with :${shown}:`}
        tabIndex={(roving ?? firstCell) === id ? 0 : -1}
        onFocus={() => setRoving(id)}
        onClick={() => pick(shown, via)}
        className={CELL}
      >
        <Emoji name={shown} custom={custom} />
      </button>
    );
  };

  const onGridKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const cells = Array.from(scroller.current?.querySelectorAll<HTMLElement>("button[data-cell]") ?? []);
    const at = cells.indexOf(e.target as HTMLElement);
    if (at < 0) return;
    let to = -1;
    if (e.key === "ArrowRight") to = at + 1;
    else if (e.key === "ArrowLeft") to = at - 1;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = cells.length - 1;
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // The nearest cell in the next row that is up or down, found by position as rows wrap.
      const here = cells[at];
      const dir = e.key === "ArrowDown" ? 1 : -1;
      let best = -1;
      let bestDx = Infinity;
      let rowTop: number | null = null;
      for (let i = at + dir; i >= 0 && i < cells.length; i += dir) {
        const top = cells[i].offsetTop;
        if (top === here.offsetTop) continue;
        rowTop ??= top;
        if (top !== rowTop) break;
        const dx = Math.abs(cells[i].offsetLeft - here.offsetLeft);
        if (dx < bestDx) {
          best = i;
          bestDx = dx;
        }
      }
      if (best < 0) {
        // Off the top of the grid: back to the search box.
        if (dir === -1) {
          e.preventDefault();
          input.current?.focus();
        }
        return;
      }
      to = best;
    } else return;
    e.preventDefault();
    if (to < 0 || to >= cells.length) return;
    cells[to].focus();
    cells[to].scrollIntoView?.({ block: "nearest" });
  };

  const section = (id: TabId, label: string, names: string[], via: "recent" | "browse") =>
    names.length > 0 && (
      <section key={id} data-section={id} aria-label={label}>
        <h3 className="sticky top-0 bg-white px-1 py-1 text-xs font-semibold text-slate-500 dark:bg-slate-900 dark:text-slate-400">{label}</h3>
        <div role="group" aria-label={label}>
          {chunks(names).map((chunk, i) => (
            <div
              key={i}
              className="flex flex-wrap [content-visibility:auto]"
              style={{ containIntrinsicSize: `auto ${Math.ceil(chunk.length / PER_ROW) * 2}rem` }}
            >
              {chunk.map((n) => cell(n, via, id))}
            </div>
          ))}
        </div>
      </section>
    );

  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: "recent" as const, label: "Frequently used", icon: "🕘" },
    ...CATEGORIES,
    ...(customList.length ? [{ id: "custom" as const, label: "Custom", icon: "⭐" }] : []),
  ];

  return (
    <>
      {/* Phones: a dimmed backdrop behind the bottom sheet (a press on it closes the picker). */}
      <div aria-hidden="true" data-testid="emoji-backdrop" className="fixed inset-0 z-40 bg-black/40 sm:hidden" />
      <div
        ref={root}
        role="dialog"
        aria-label="Pick an emoji"
        style={shift ? { transform: `translateX(${shift}px)` } : undefined}
        className={`fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] w-full flex-col rounded-t-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900 sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:z-40 sm:max-h-none sm:w-80 sm:rounded-lg ${flip ? "sm:bottom-full sm:mb-1" : "sm:top-full sm:mt-1"}`}
      >
      <div className="flex items-center">
        <input
          ref={input}
          type="search"
          aria-label="Search emoji"
          placeholder="Search emoji"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setRoving(null);
          }}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown") return;
            const first = scroller.current?.querySelector<HTMLElement>("button[data-cell]");
            if (first) {
              e.preventDefault();
              first.focus();
            }
          }}
          className="m-2 min-h-10 min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-base text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="mr-2 h-10 w-10 shrink-0 rounded text-xl text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 sm:hidden"
        >
          &times;
        </button>
      </div>
      {!searching && (
        <div role="tablist" aria-label="Emoji categories" className="flex gap-0.5 overflow-x-auto border-b border-slate-200 px-2 pb-1 dark:border-slate-700">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active === t.id}
              aria-label={t.label}
              title={t.label}
              onClick={() => jump(t.id)}
              className={`h-10 w-10 shrink-0 rounded text-lg hover:bg-slate-100 dark:hover:bg-slate-800 ${active === t.id ? "bg-plum-50 dark:bg-plum-900/30" : ""}`}
            >
              {t.icon}
            </button>
          ))}
        </div>
      )}
      <div role="radiogroup" aria-label="Skin tone" className="flex items-center gap-0.5 overflow-x-auto px-2 pb-1">
        {[{ tone: null, label: "Default", sample: "\u{1F44D}" }, ...SKIN_TONES].map((t) => (
          <button
            key={t.label}
            type="button"
            role="radio"
            aria-checked={tone === t.tone}
            aria-label={`${t.label} skin tone`}
            title={`${t.label} skin tone`}
            onClick={() => chooseTone(t.tone)}
            className={`h-10 w-10 shrink-0 rounded text-lg hover:bg-slate-100 dark:hover:bg-slate-800 ${tone === t.tone ? "bg-plum-50 ring-1 ring-plum-400 dark:bg-plum-900/30" : ""}`}
          >
            {t.sample}
          </button>
        ))}
      </div>
      {/* Arrow keys move through the cells (the grid is one tab stop). */}
      { }
      <div ref={scroller} onKeyDown={onGridKey} className="relative h-64 min-h-0 overflow-y-auto px-2 pb-2">
        {failed ? (
          <p role="alert" className="p-2 text-sm text-red-600 dark:text-red-400">
            Couldn&apos;t load the emoji. Close this and try again.
          </p>
        ) : searching ? (
          standardHits.length + customHits.length === 0 ? (
            catalog || customHits.length ? (
              <p className="p-2 text-sm text-slate-500 dark:text-slate-400">No emoji match &ldquo;{query.trim()}&rdquo;.</p>
            ) : null
          ) : (
            <div role="group" aria-label="Search results" className="flex flex-wrap pt-1">
              {customHits.map((n) => cell(n, "search", "search"))}
              {standardHits.map((e) => cell(e.name, "search", "search"))}
            </div>
          )
        ) : (
          <>
            {section("recent", "Frequently used", recents, "recent")}
            {!catalog && <p className="p-2 text-sm text-slate-500 dark:text-slate-400">Loading…</p>}
            {CATEGORIES.map((c) =>
              section(
                c.id,
                c.label,
                (byCategory.get(c.id) ?? []).map((e) => e.name),
                "browse"
              )
            )}
            {section("custom", "Custom", customList, "browse")}
          </>
        )}
      </div>
      </div>
    </>
  );
}

function chunks(names: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < names.length; i += CHUNK) out.push(names.slice(i, i + CHUNK));
  return out;
}