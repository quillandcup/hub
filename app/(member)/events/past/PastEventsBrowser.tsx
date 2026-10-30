"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PillFilter, type PillOption } from "@/components/PillFilter";
import { agendaItemOfEvent, agendaItemOfPrickle, AgendaWeeks, type EventRow } from "../AgendaList";
import { pastAgendaWeeks, withoutFollowedEvents, type AgendaMonth } from "@/lib/events-agenda";
import type { EventPrickle } from "@/lib/event-prickles";

/** Keep `?month=` in sync without a server round trip. */
function syncUrl(month: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("month", month);
  window.history.replaceState(window.history.state, "", url.toString());
}

/**
 * Past events a month at a time, back as far as there are any: pick a year, then a month in it. The events are all
 * here already; the prickles of listed types (the weekly sessions) come a month at a time from the server, and are
 * fetched ahead for a month someone points at and for the months either side of the one open, so paging through
 * them is instant.
 */
export default function PastEventsBrowser({
  initialMonth,
  months,
  events,
  followedCalendarEventIds,
  initialPrickles,
  timeZone,
}: {
  initialMonth: string;
  /** Every month offered, oldest first. */
  months: AgendaMonth[];
  /** The events that have already ended. */
  events: EventRow[];
  /** Calendar items an event follows: such an event stands in for its prickle. */
  followedCalendarEventIds: string[];
  /** The listed prickles of `initialMonth`, loaded with the page. */
  initialPrickles: EventPrickle[];
  timeZone: string;
}) {
  const [monthId, setMonthState] = useState(initialMonth);
  const [prickles, setPrickles] = useState<Record<string, EventPrickle[]>>({ [initialMonth]: initialPrickles });
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const asked = useRef(new Set<string>([initialMonth]));

  const load = useCallback((id: string) => {
    if (asked.current.has(id) || !months.some((m) => m.id === id)) return;
    asked.current.add(id);
    fetch(`/api/events/past-prickles?month=${id}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { prickles: EventPrickle[] }) => setPrickles((known) => ({ ...known, [id]: body.prickles })))
      .catch(() => {
        asked.current.delete(id);
        setFailed((known) => ({ ...known, [id]: true }));
      });
  }, [months]);

  // The open month's, then the ones either side of it, in the order someone pages through them.
  useEffect(() => {
    const at = months.findIndex((m) => m.id === monthId);
    for (const m of [months[at], months[at - 1], months[at + 1]]) if (m) load(m.id);
  }, [monthId, months, load]);

  if (months.length === 0) return <p className="text-sm text-slate-600 dark:text-slate-400">No past events yet.</p>;

  const month = months.find((m) => m.id === monthId) ?? months[months.length - 1];
  const year = month.id.slice(0, 4);
  const years = [...new Set(months.map((m) => m.id.slice(0, 4)))].reverse();
  const yearOptions: PillOption<string>[] = years.map((y) => ({ id: y, label: y }));
  const monthOptions: PillOption<string>[] = months.filter((m) => m.id.startsWith(year)).map((m) => ({ id: m.id, label: m.label }));
  const lastMonthOf = (y: string) => months.filter((m) => m.id.startsWith(y)).at(-1)!.id;
  const setMonth = (id: string) => {
    setMonthState(id);
    syncUrl(id);
  };

  const loaded = prickles[month.id];
  const items = [
    ...events.map((e) => agendaItemOfEvent(e, timeZone)),
    ...withoutFollowedEvents(loaded ?? [], followedCalendarEventIds).map((p) => agendaItemOfPrickle(p, timeZone)),
  ];
  const weeks = pastAgendaWeeks(items, month);

  return (
    <div>
      <PillFilter ariaLabel="Year" options={yearOptions} value={year} onChange={(y) => setMonth(lastMonthOf(y))} onIntent={(y) => load(lastMonthOf(y))} className="mb-3" />
      <PillFilter ariaLabel="Month" size="sm" options={monthOptions} value={month.id} onChange={setMonth} onIntent={load} className="mb-4" />
      <section aria-label={`${month.label} ${year}`}>
        <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-3">{month.label} {year}</h2>
        {weeks.length === 0 && loaded && <p className="text-sm text-slate-600 dark:text-slate-400">Nothing in {month.label} {year}.</p>}
        {weeks.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900">
            <AgendaWeeks weeks={weeks} timeZone={timeZone} />
          </div>
        )}
        {!loaded && !failed[month.id] && <p role="status" className="mt-3 text-sm text-slate-600 dark:text-slate-400">Loading sessions…</p>}
        {!loaded && failed[month.id] && (
          <p role="alert" className="mt-3 text-sm text-slate-600 dark:text-slate-400">
            Couldn&apos;t load the sessions.{" "}
            <button type="button" onClick={() => { setFailed((known) => ({ ...known, [month.id]: false })); load(month.id); }} className="text-plum-600 dark:text-plum-400 hover:underline">
              Try again
            </button>
          </p>
        )}
      </section>
    </div>
  );
}
