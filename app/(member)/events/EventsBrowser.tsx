"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { PillFilter, type PillOption } from "@/components/PillFilter";
import { locationDisplay } from "@/lib/location-display";
import { useWithSecondaryTime } from "@/components/SecondaryTimezone";
import EventArt from "@/components/EventArt";
import { EVENT_TYPE_LABELS, eventTier, type EventTier, type EventType } from "@/lib/events-filter";
import { agendaWeeks, cleanEventTitle, formatTimeSpan, type AgendaMonth } from "@/lib/events-agenda";
import type { EventPrickle } from "@/lib/event-prickles";
import {
  AgendaWeeks,
  agendaItemOfEvent,
  agendaItemOfPrickle,
  eventDays,
  fmtDateRange,
  type EventRow,
} from "./AgendaList";

export type { EventRow };

// Type-only (erased at compile time), so none of lib/event-prickles.ts's server-side
// query code reaches the client bundle. Re-exported for existing importers.
export type { EventPrickle };

// What each highlighted tier is called as a section.
const HIGHLIGHT_SECTIONS: { tier: EventTier; heading: string }[] = [
  { tier: "special", heading: "Special events" },
  { tier: "educational", heading: "Educational" },
];

/** Keep `?month=` in sync without a server round trip (the page already has all the data). */
function syncUrl(month: string, firstMonth: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (month === firstMonth) url.searchParams.delete("month");
  else url.searchParams.set("month", month);
  window.history.replaceState(window.history.state, "", url.toString());
}

export default function EventsBrowser({
  initialMonth,
  months,
  events,
  eventPrickles,
  today,
  timeZone,
}: {
  initialMonth: string;
  months: AgendaMonth[];
  events: EventRow[];
  eventPrickles: EventPrickle[];
  today: string;
  timeZone: string;
}) {
  const [monthId, setMonthState] = useState(initialMonth);
  const setMonth = (next: string) => {
    setMonthState(next);
    syncUrl(next, months[0].id);
  };

  const month = months.find((m) => m.id === monthId) ?? months[0];
  const items = [...events.map((e) => agendaItemOfEvent(e, timeZone)), ...eventPrickles.map((p) => agendaItemOfPrickle(p, timeZone))];
  const options: PillOption<string>[] = months.map((m) => ({ id: m.id, label: m.label, count: agendaWeeks(items, m, today).reduce((n, w) => n + w.days.reduce((k, d) => k + d.items.length, 0), 0) }));
  const weeks = agendaWeeks(items, month, today);

  const upcoming = events
    .map((e) => ({ event: e, ...eventDays(e, timeZone) }))
    .filter((e) => e.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));

  return (
    <div>
      {HIGHLIGHT_SECTIONS.map(({ tier, heading }) => {
        const inTier = upcoming.filter((e) => eventTier(e.event) === tier);
        if (inTier.length === 0) return null;
        return (
          <section key={tier} aria-label={heading} className="mb-8">
            <SectionHeading>{heading}</SectionHeading>
            <div className="@container">
              <div className="grid grid-cols-1 @pair:grid-cols-2 gap-4">
                {inTier.map(({ event, startDate, endDate, timed }, i) => (
                  <EventCard key={event.id} event={event} startDate={startDate} endDate={endDate} timed={timed} timeZone={timeZone} artOnRight={i % 2 === 1} />
                ))}
              </div>
            </div>
          </section>
        );
      })}

      <section aria-label={`${month.label} at a glance`} className="mb-8">
        <SectionHeading>{month.label} at a glance</SectionHeading>
        <PillFilter ariaLabel="Month" options={options} value={monthId} onChange={setMonth} className="mb-2" />
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
          {month.first <= today && `Counts and the list are what's still ahead in ${month.label}. `}
          <Link data-track="events-open-past" href={`/events/past?month=${month.first <= today ? month.id : ""}`} className="text-plum-600 dark:text-plum-400 hover:underline">
            See past events
          </Link>
        </p>
        {weeks.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">Nothing scheduled in {month.label} yet.</p>
        ) : (
          <AgendaWeeks weeks={weeks} timeZone={timeZone} />
        )}
      </section>
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-3">
      {children}
    </h2>
  );
}

/** A highlighted event: the picture to one side and the words beside it, so a title wraps little. */
function EventCard({
  event,
  startDate,
  endDate,
  timed,
  timeZone,
  artOnRight,
}: {
  event: EventRow;
  startDate: string;
  endDate: string;
  timed: boolean;
  timeZone: string;
  artOnRight: boolean;
}) {
  const withSecondary = useWithSecondaryTime();
  const where = locationDisplay(event.location);
  const needsSignUp = !!event.registration && event.registration !== "none";
  const time = timed ? formatTimeSpan(event.start_time, event.end_time, timeZone) : "";
  const when = [fmtDateRange(startDate, endDate), time && event.start_time ? withSecondary(time, event.start_time, timeZone) : time, where && !where.href ? where.text : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link data-track="events-event-location-event-focus"
      href={`/events/${event.slug}`}
      className={`flex ${artOnRight ? "flex-row-reverse" : ""} bg-white dark:bg-slate-900 rounded-lg shadow overflow-hidden hover:shadow-md transition-shadow`}
    >
      <div className="w-28 flex-shrink-0 self-stretch overflow-hidden">
        <EventArt
          eventType={event.event_type}
          icon={event.badge_icon}
          coverUrl={event.cover_photo_id ? `/api/events/${event.id}/photos/${event.cover_photo_id}` : null}
          className="h-full min-h-28"
        />
      </div>
      <div className="min-w-0 flex-1 p-4">
        <p className="text-xs text-slate-600 dark:text-slate-400 uppercase tracking-wide">
          {EVENT_TYPE_LABELS[event.event_type as EventType] || event.event_type}
          {needsSignUp ? " · Sign-up required" : ""}
        </p>
        <h3 className="font-semibold mt-0.5">{cleanEventTitle(event.title)}</h3>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{when}</p>
        {event.focus && <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{event.focus}</p>}
      </div>
    </Link>
  );
}
