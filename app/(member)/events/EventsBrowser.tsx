"use client";

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { PillFilter, type PillOption } from "@/components/PillFilter";
import { locationDisplay } from "@/lib/location-display";
import { useWithSecondaryTime } from "@/components/SecondaryTimezone";
import EventArt from "@/components/EventArt";
import { EVENT_TYPE_LABELS, eventTier, type EventTier, type EventType } from "@/lib/events-filter";
import { eventDisplayName } from "@/lib/event-name";
import {
  agendaWeeks,
  cleanEventTitle,
  dateIn,
  formatTimeSpan,
  isAllDay,
  type AgendaItem,
  type AgendaMonth,
} from "@/lib/events-agenda";
import type { EventPrickle } from "@/lib/event-prickles";

export interface EventRow {
  id: string;
  slug: string;
  title: string;
  event_type: string;
  location: string | null;
  starts_at: string;
  ends_at: string;
  /** The exact instants when the event follows a calendar item; absent or null for one with dates only. */
  start_time?: string | null;
  end_time?: string | null;
  focus: string | null;
  registration?: string | null;
  /** The icon of the badge the event awards (a retreat's), shown on its card when there is no photo. */
  badge_icon?: string | null;
  cover_photo_id: string | null;
}

// Type-only (erased at compile time), so none of lib/event-prickles.ts's server-side
// query code reaches the client bundle. Re-exported for existing importers.
export type { EventPrickle };

// What each highlighted tier is called as a section.
const HIGHLIGHT_SECTIONS: { tier: EventTier; heading: string }[] = [
  { tier: "special", heading: "Special events" },
  { tier: "educational", heading: "Educational" },
];

/** "Nov 6" or "Fri, Nov 6" from a YYYY-MM-DD date (a calendar date has no zone, so read it as UTC). */
function fmtDate(d: string, withWeekday = false) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...(withWeekday ? { weekday: "short" } : {}), month: "short", day: "numeric" });
}

function fmtDateRange(start: string, end: string) {
  return start === end ? fmtDate(start, true) : `${fmtDate(start)} – ${fmtDate(end)}`;
}

/** The days an event covers as the viewer reads them: from its instants when it has them, else its dates. */
function eventDays(e: EventRow, timeZone: string): { startDate: string; endDate: string; timed: boolean } {
  if (!e.start_time || !e.end_time) return { startDate: e.starts_at, endDate: e.ends_at, timed: false };
  const start = Date.parse(e.start_time);
  // An event that ends exactly at midnight ends the day before.
  const lastMinute = new Date(Math.max(start, Date.parse(e.end_time) - 60_000)).toISOString();
  return { startDate: dateIn(e.start_time, timeZone), endDate: dateIn(lastMinute, timeZone), timed: !isAllDay(e.start_time, e.end_time) };
}

function agendaItemOfEvent(e: EventRow, timeZone: string): AgendaItem {
  const { startDate, endDate, timed } = eventDays(e, timeZone);
  const where = locationDisplay(e.location);
  const time = timed ? formatTimeSpan(e.start_time, e.end_time, timeZone) : "";
  return {
    key: `event-${e.id}`,
    href: `/events/${e.slug}`,
    title: cleanEventTitle(e.title),
    startDate,
    endDate,
    time,
    // Online is the default, so only a place is worth a line.
    place: where && !where.href ? where.text : null,
    startsAt: timed ? e.start_time ?? null : null,
    track: "events-open-agenda-event",
  };
}

function agendaItemOfPrickle(p: EventPrickle, timeZone: string): AgendaItem {
  const lastMinute = new Date(Math.max(Date.parse(p.startTime), Date.parse(p.endTime) - 60_000)).toISOString();
  return {
    key: `prickle-${p.id}`,
    href: `/prickles/${p.id}`,
    title: eventDisplayName(cleanEventTitle(p.title || p.typeName), null, p.hostName),
    startDate: dateIn(p.startTime, timeZone),
    endDate: dateIn(lastMinute, timeZone),
    time: formatTimeSpan(p.startTime, p.endTime, timeZone),
    place: null,
    startsAt: p.startTime,
    track: "events-open-agenda-prickle",
  };
}

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
        <PillFilter ariaLabel="Month" options={options} value={monthId} onChange={setMonth} className="mb-4" />
        {weeks.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">Nothing scheduled in {month.label} yet.</p>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900">
            {weeks.map((week, w) => (
              <Fragment key={week.start}>
                {w > 0 && <WeekDivider />}
                <ul aria-label={`Week of ${fmtDate(week.start)}`} className="py-2">
                  {week.days.map((day) => (
                    <li key={day.date} className="flex gap-4 py-2">
                      <DayLabel date={day.date} />
                      <ul className="min-w-0 flex-1 space-y-2">
                        {day.items.map((item) => (
                          <AgendaRow key={item.key} item={item} timeZone={timeZone} />
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </Fragment>
            ))}
          </div>
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

/** Between weeks: a quiet rule with a diamond, like the monthly flyer's. */
function WeekDivider() {
  return (
    <div role="separator" className="flex items-center gap-2 text-plum-400 dark:text-plum-600">
      <span className="h-px flex-1 bg-current opacity-50" />
      <span aria-hidden="true" className="text-xs">◆</span>
      <span className="h-px flex-1 bg-current opacity-50" />
    </div>
  );
}

function DayLabel({ date }: { date: string }) {
  const d = new Date(`${date}T00:00:00Z`);
  return (
    <div className="w-12 flex-shrink-0 text-center" aria-label={fmtDate(date, true)}>
      <p aria-hidden="true" className="text-xs uppercase tracking-wide text-slate-600 dark:text-slate-400">
        {d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" })}
      </p>
      <p aria-hidden="true" className="text-xl font-semibold leading-tight">{d.getUTCDate()}</p>
    </div>
  );
}

function AgendaRow({ item, timeZone }: { item: AgendaItem; timeZone: string }) {
  const withSecondary = useWithSecondaryTime();
  const span = item.startDate === item.endDate ? null : `${fmtDate(item.startDate)} – ${fmtDate(item.endDate)}`;
  const details = [span, item.time && item.startsAt ? withSecondary(item.time, item.startsAt, timeZone) : item.time, item.place].filter(Boolean).join(" · ");
  return (
    <li>
      <Link
        data-track={item.track}
        href={item.href}
        className="block -mx-2 px-2 py-1 rounded hover:bg-slate-50 dark:hover:bg-slate-800/50"
      >
        <p className="font-medium">{item.title}</p>
        {details && <p className="text-sm text-slate-600 dark:text-slate-400">{details}</p>}
      </Link>
    </li>
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
