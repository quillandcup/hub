"use client";

import { useState } from "react";
import { PillFilter, type PillOption } from "@/components/PillFilter";
import { agendaItemOfEvent, AgendaWeeks, type EventRow } from "../AgendaList";
import { monthsWithItems, pastAgendaWeeks } from "@/lib/events-agenda";

/** Keep `?month=` in sync without a server round trip (the page already has all the data). */
function syncUrl(month: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("month", month);
  window.history.replaceState(window.history.state, "", url.toString());
}

/** Past events a month at a time, back as far as there are any: pick a year, then a month in it. */
export default function PastEventsBrowser({
  initialMonth,
  events,
  timeZone,
}: {
  initialMonth: string | null;
  /** The events that have already ended. */
  events: EventRow[];
  timeZone: string;
}) {
  const items = events.map((e) => agendaItemOfEvent(e, timeZone));
  const months = monthsWithItems(items);
  const [monthId, setMonthState] = useState(months.find((m) => m.id === initialMonth)?.id ?? months[0]?.id ?? "");

  if (months.length === 0) return <p className="text-sm text-slate-600 dark:text-slate-400">No past events yet.</p>;

  const month = months.find((m) => m.id === monthId) ?? months[0];
  const year = month.id.slice(0, 4);
  const years = [...new Set(months.map((m) => m.id.slice(0, 4)))];
  const yearOptions: PillOption<string>[] = years.map((y) => ({ id: y, label: y, count: months.filter((m) => m.id.startsWith(y)).reduce((n, m) => n + m.count, 0) }));
  const monthOptions: PillOption<string>[] = months
    .filter((m) => m.id.startsWith(year))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((m) => ({ id: m.id, label: m.label, count: m.count }));
  const setMonth = (id: string) => {
    setMonthState(id);
    syncUrl(id);
  };

  return (
    <div>
      <PillFilter ariaLabel="Year" options={yearOptions} value={year} onChange={(y) => setMonth(months.find((m) => m.id.startsWith(y))!.id)} className="mb-3" />
      <PillFilter ariaLabel="Month" size="sm" options={monthOptions} value={month.id} onChange={setMonth} className="mb-4" />
      <section aria-label={`${month.label} ${year}`}>
        <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-3">{month.label} {year}</h2>
        <div className="rounded-lg border border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900">
          <AgendaWeeks weeks={pastAgendaWeeks(items, month)} timeZone={timeZone} />
        </div>
      </section>
    </div>
  );
}
