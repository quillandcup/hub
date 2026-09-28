"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { PrickleCalendarState } from "@/lib/calendar-feed";
import { addEventToMyCalendar, addPrickleToMyCalendar, removeMyCalendarItem } from "./calendar-feed-actions";

/** Stand-in item id while an add is in flight; the refreshed page brings the real one. */
const OPTIMISTIC_ID = "pending";

/**
 * "Add to my calendar" controls: put a prickle (just this one, or every week) or an event into the
 * member's synced calendar feed (lib/calendar-feed.ts). Prickles they host or committed to are
 * already in it, so those show as included instead.
 */

const SYNC_HINT_HREF = "/my-prickles?tab=commitments";

function CalendarGlyph({ added, className = "w-4 h-4" }: { added: boolean; className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
      {added ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 15.5l2 2 3.5-4" />
      ) : (
        <path strokeLinecap="round" d="M12 13v5M9.5 15.5h5" />
      )}
    </svg>
  );
}

function CheckMark({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
        on ? "border-plum-600 bg-plum-600 text-white" : "border-slate-300 dark:border-slate-600"
      }`}
    >
      {on && (
        <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12l5 5 9-10" />
        </svg>
      )}
    </span>
  );
}

export type AutoIncludedReason = "hosting" | "committed";

const AUTO_LABEL: Record<AutoIncludedReason, string> = {
  hosting: "In your calendar: you're hosting",
  committed: "In your calendar: you're committed",
};

export function AddPrickleToCalendar({
  prickleId,
  typeName,
  nextLabel,
  state,
  autoIncluded = null,
  variant = "button",
}: {
  prickleId: string;
  typeName: string;
  /** When "just this one" is, e.g. "Tue, Oct 6". */
  nextLabel: string;
  state: PrickleCalendarState;
  autoIncluded?: AutoIncludedReason | null;
  /** "icon" for dense rows (All Prickles table), "button" elsewhere. */
  variant?: "icon" | "button";
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Flip the checkmark and icon the moment it's clicked; the real state arrives with the action's
  // refreshed page, and on an error the optimistic value falls back to the unchanged prop.
  const [shown, setShown] = useOptimistic(state);
  const [busy, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const added = !!(shown.onceItemId || shown.weeklyItemId);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (autoIncluded) {
    const label = AUTO_LABEL[autoIncluded];
    return variant === "icon" ? (
      <span title={label} aria-label={label} role="img" className="inline-flex p-1 text-emerald-600 dark:text-emerald-400">
        <CalendarGlyph added />
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
        <CalendarGlyph added /> {label}
      </span>
    );
  }

  function toggle(mode: "once" | "weekly") {
    const key = mode === "once" ? "onceItemId" : "weeklyItemId";
    const existing = shown[key];
    setError(null);
    startTransition(async () => {
      setShown({ ...shown, [key]: existing ? null : OPTIMISTIC_ID });
      const result = existing ? await removeMyCalendarItem(existing) : await addPrickleToMyCalendar(prickleId, mode);
      if ("error" in result) setError(result.error);
    });
  }

  const triggerLabel = added ? `${typeName} is in your calendar` : `Add ${typeName} to your calendar`;

  return (
    <div ref={ref} className="relative inline-block text-left">
      {variant === "icon" ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={triggerLabel}
          title={added ? "In your calendar" : "Add to my calendar"}
          className={`p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 ${
            added ? "text-plum-600 dark:text-plum-400" : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          }`}
        >
          <CalendarGlyph added={added} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <CalendarGlyph added={added} />
          {added ? "In my calendar" : "Add to my calendar"}
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}

      {open && (
        <div
          role="menu"
          aria-label={`Add ${typeName} to your calendar`}
          className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-1 text-sm"
        >
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={added}
            disabled={busy || !!shown.weeklyItemId}
            onClick={() => toggle("once")}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60 disabled:hover:bg-transparent"
          >
            <CheckMark on={added} />
            <span>
              Just this one <span className="text-slate-500 dark:text-slate-400">· {nextLabel}</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={!!shown.weeklyItemId}
            disabled={busy}
            onClick={() => toggle("weekly")}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
          >
            <CheckMark on={!!shown.weeklyItemId} />
            <span>Every week</span>
          </button>
          <p className="px-2 pt-1.5 pb-1 text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 mt-1">
            Shows up in your synced calendar.{" "}
            <Link href={SYNC_HINT_HREF} className="text-plum-600 dark:text-plum-400 hover:underline">
              Set up sync
            </Link>
          </p>
          {error && (
            <p role="alert" className="px-2 pb-1 text-xs text-rose-700 dark:text-rose-400">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function AddEventToCalendar({ eventId, itemId: savedItemId }: { eventId: string; itemId: string | null }) {
  const [itemId, setItemId] = useOptimistic(savedItemId);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const existing = itemId;
    setError(null);
    startTransition(async () => {
      setItemId(existing ? null : OPTIMISTIC_ID);
      const result = existing ? await removeMyCalendarItem(existing) : await addEventToMyCalendar(eventId);
      if ("error" in result) setError(result.error);
    });
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          aria-pressed={!!itemId}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
        >
          <CalendarGlyph added={!!itemId} />
          {itemId ? "In my calendar · Remove" : "Add to my calendar"}
        </button>
        <Link href={SYNC_HINT_HREF} className="text-xs text-slate-500 dark:text-slate-400 hover:underline">
          Set up calendar sync
        </Link>
      </div>
      {error && (
        <p role="alert" className="text-xs text-rose-700 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}
