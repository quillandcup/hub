"use client";

import { useOptimistic, useState, useTransition } from "react";
import type { MyCalendarItem } from "@/lib/calendar-feed";
import { removeMyCalendarItem } from "./calendar-feed-actions";

/**
 * The prickles and events the member added to their calendar by hand (on top of hosted and
 * committed prickles), each with a remove button. Always shown, apart from the collapsible
 * one-time setup in CalendarSyncCard: these are the member's own ongoing choices.
 */
export default function AddedToCalendarList({ items }: { items: MyCalendarItem[] }) {
  const [shown, removeShown] = useOptimistic(items, (current, removedId: string) =>
    current.filter((item) => item.id !== removedId)
  );
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) return null;

  function removeItem(item: MyCalendarItem) {
    setError(null);
    startTransition(async () => {
      removeShown(item.id);
      const result = await removeMyCalendarItem(item.id);
      if ("error" in result) setError(result.error);
    });
  }

  return (
    <section
      aria-labelledby="added-to-calendar-heading"
      className="mt-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5"
    >
      <h2 id="added-to-calendar-heading" className="font-semibold text-slate-900 dark:text-slate-100">
        Also added to your calendar
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
        Prickles and events you added with <span className="font-medium">Add to my calendar</span>.
      </p>
      <ul className="mt-3 space-y-1">
        {shown.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 text-sm text-slate-700 dark:text-slate-300">
            <span className="min-w-0 truncate">{item.label}</span>
            <button
              type="button"
              onClick={() => removeItem(item)}
              aria-label={`Remove ${item.label} from your calendar`}
              className="shrink-0 text-xs text-slate-500 hover:text-rose-700 dark:hover:text-rose-400"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="mt-2 text-xs text-rose-700 dark:text-rose-400" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
