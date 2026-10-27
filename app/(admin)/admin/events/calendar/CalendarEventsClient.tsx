"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PillFilter } from "@/components/PillFilter";
import { formatDateTime } from "@/lib/formatters";
import { CALENDAR_LIST_PAGE_SIZE, type CalendarListFilter, type CalendarListItem } from "@/lib/calendar-events";

const FILTERS = [
  { id: "upcoming" as const, label: "Upcoming" },
  { id: "in_events" as const, label: "Shown in Events" },
];

export default function CalendarEventsClient() {
  const [filter, setFilter] = useState<CalendarListFilter>("upcoming");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<CalendarListItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showingId, setShowingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ filter, offset: String(offset) });
      if (search.trim()) params.set("q", search.trim());
      const response = await fetch(`/api/admin/events/calendar?${params}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to load calendar items");
      setItems(body.items);
      setHasMore(body.hasMore);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filter, search, offset]);

  useEffect(() => {
    load();
  }, [load]);

  const showInEvents = async (item: CalendarListItem) => {
    setShowingId(item.id);
    setError(null);
    try {
      const response = await fetch("/api/admin/events/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarEventId: item.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to show in Events");
      setItems((current) => current.map((i) => (i.id === item.id ? { ...i, event: body.event } : i)));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setShowingId(null);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <PillFilter
          ariaLabel="Calendar items"
          options={FILTERS}
          value={filter}
          onChange={(next) => {
            setFilter(next);
            setOffset(0);
          }}
        />
        <input
          type="search"
          aria-label="Search calendar items"
          placeholder="Search by title"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
          className="px-3 py-1.5 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded text-sm"
        />
        <Link href="/admin/hygiene/unmatched-events" className="text-sm text-plum-600 dark:text-plum-400 hover:underline ml-auto">
          Items waiting for a prickle type →
        </Link>
      </div>

      {loading ? (
        <p className="text-slate-600 dark:text-slate-400">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-slate-600 dark:text-slate-400">No calendar items.</p>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-slate-800">
          {items.map((item) => (
            <li key={item.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium truncate">{item.summary || "Untitled"}</p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {formatDateTime(item.start_time)}
                  {item.location ? ` · ${item.location}` : ""}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  {item.needsType ? "Needs a prickle type" : item.prickleType ? `Prickle · ${item.prickleType}` : "Not a prickle"}
                </p>
              </div>
              {item.event ? (
                <Link
                  href={`/admin/events/${item.event.id}`}
                  className="text-sm text-plum-600 dark:text-plum-400 hover:underline flex-shrink-0"
                >
                  In Events · Edit
                </Link>
              ) : (
                <button
                  type="button"
                  disabled={showingId === item.id}
                  onClick={() => showInEvents(item)}
                  className="px-3 py-1.5 text-sm bg-plum-600 text-white rounded hover:bg-plum-700 disabled:opacity-50 flex-shrink-0"
                >
                  {showingId === item.id ? "Adding..." : "Show in Events"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-between mt-4">
        <button
          type="button"
          disabled={offset === 0 || loading}
          onClick={() => setOffset(Math.max(0, offset - CALENDAR_LIST_PAGE_SIZE))}
          className="text-sm text-plum-600 dark:text-plum-400 hover:underline disabled:opacity-40 disabled:no-underline"
        >
          ← Earlier
        </button>
        <button
          type="button"
          disabled={!hasMore || loading}
          onClick={() => setOffset(offset + CALENDAR_LIST_PAGE_SIZE)}
          className="text-sm text-plum-600 dark:text-plum-400 hover:underline disabled:opacity-40 disabled:no-underline"
        >
          Later →
        </button>
      </div>
    </div>
  );
}
