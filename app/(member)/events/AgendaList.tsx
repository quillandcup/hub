"use client";

import { Fragment } from "react";
import Link from "next/link";
import { locationDisplay } from "@/lib/location-display";
import { useWithSecondaryTime } from "@/components/SecondaryTimezone";
import { eventDisplayName } from "@/lib/event-name";
import { cleanEventTitle, dateIn, eventDays, formatTimeSpan, type AgendaItem, type AgendaWeek } from "@/lib/events-agenda";
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
  /** The cover picked from the media library; it wins over the first imported photo. */
  image_id?: string | null;
  cover_photo_id: string | null;
}


/** "Nov 6" or "Fri, Nov 6" from a YYYY-MM-DD date (a calendar date has no zone, so read it as UTC). */
export function fmtDate(d: string, withWeekday = false) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...(withWeekday ? { weekday: "short" } : {}), month: "short", day: "numeric" });
}

export function fmtDateRange(start: string, end: string) {
  return start === end ? fmtDate(start, true) : `${fmtDate(start)} – ${fmtDate(end)}`;
}

export function agendaItemOfEvent(e: EventRow, timeZone: string): AgendaItem {
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

export function agendaItemOfPrickle(p: EventPrickle, timeZone: string): AgendaItem {
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

/** A month's items by week and day: the date on the left, what is on that day beside it. */
export function AgendaWeeks({ weeks, timeZone }: { weeks: AgendaWeek[]; timeZone: string }) {
  return (
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
  );
}
