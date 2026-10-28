"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { PillFilter, type PillOption } from "@/components/PillFilter";
import { hostShortName } from "@/lib/formatters";
import { locationDisplay } from "@/lib/location-display";
import { useWithSecondaryTime } from "@/components/SecondaryTimezone";
import EventArt from "@/components/EventArt";
import {
  EVENT_FILTER_IDS,
  EVENT_FILTER_LABELS,
  EVENT_TYPE_LABELS,
  countUpcoming,
  eventTier,
  groupEvents,
  type EventFilter,
  type EventTier,
  type EventType,
} from "@/lib/events-filter";
import type { EventPrickle } from "@/lib/event-prickles";

export interface EventRow {
  id: string;
  slug: string;
  title: string;
  event_type: string;
  location: string | null;
  starts_at: string;
  ends_at: string;
  focus: string | null;
  registration?: string | null;
  /** The icon of the badge the event awards (a retreat's), shown on its card when there is no photo. */
  badge_icon?: string | null;
  cover_photo_id: string | null;
}

// Type-only (erased at compile time), so none of lib/event-prickles.ts's server-side
// query code reaches the client bundle. Re-exported for existing importers.
export type { EventPrickle };

const EMPTY_LABELS: Record<EventFilter, string> = {
  all: "events",
  big: "big events",
  educational: "educational events",
  events: "events",
  sessions: "sessions",
};

// What each tier is called as a section, and how its cards look: the big ones get a tall picture, the rest less.
const TIER_SECTIONS: { tier: EventTier; heading: string; artClass: string }[] = [
  { tier: "big", heading: "Big events", artClass: "h-40" },
  { tier: "educational", heading: "Educational", artClass: "h-28" },
  { tier: "event", heading: "Events", artClass: "h-28" },
];

function fmtDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateRange(start: string, end: string) {
  return start === end ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`;
}

function fmtPrickleTime(iso: string, timeZone: string) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** Keep `?type=` in sync without a server round trip (the page already has all the data). */
function syncUrl(filter: EventFilter) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (filter === "all") url.searchParams.delete("type");
  else url.searchParams.set("type", filter);
  window.history.replaceState(window.history.state, "", url.toString());
}

export default function EventsBrowser({
  initialFilter,
  events,
  eventPrickles,
  today,
  timeZone,
}: {
  initialFilter: EventFilter;
  events: EventRow[];
  eventPrickles: EventPrickle[];
  today: string;
  timeZone: string;
}) {
  const [filter, setFilterState] = useState<EventFilter>(initialFilter);
  const setFilter = (next: EventFilter) => {
    setFilterState(next);
    syncUrl(next);
  };

  const counts = countUpcoming(events, eventPrickles.length, today);
  const { upcoming, past } = groupEvents(events, filter, today);
  // The Events pill (one-off gatherings) only appears when there is one, or it is the filter in use.
  const options: PillOption<EventFilter>[] = EVENT_FILTER_IDS.filter((id) => id !== "events" || counts.events > 0 || filter === "events").map((id) => ({ id, label: EVENT_FILTER_LABELS[id], count: counts[id] }));
  const showsPrickles = filter === "all" || filter === "sessions";
  const sessionEvents = upcoming.filter((e) => eventTier(e) === "session");
  const hasUpcoming = upcoming.length > 0 || (showsPrickles && eventPrickles.length > 0);

  return (
    <div>
      <PillFilter ariaLabel="Event type" options={options} value={filter} onChange={setFilter} />

      <div className="mt-6">
        {TIER_SECTIONS.map(({ tier, heading, artClass }) => {
          const inTier = upcoming.filter((e) => eventTier(e) === tier);
          if (inTier.length === 0) return null;
          return (
            <section key={tier} aria-label={heading} className="mb-8">
              <SectionHeading>{heading}</SectionHeading>
              <div className="@container">
                <div className="grid grid-cols-1 @pair:grid-cols-2 @columns:grid-cols-3 gap-4">
                  {inTier.map((event) => (
                    <EventCard key={event.id} event={event} artClass={artClass} />
                  ))}
                </div>
              </div>
            </section>
          );
        })}

        {showsPrickles && (sessionEvents.length > 0 || eventPrickles.length > 0) && (
          <SessionsSection events={sessionEvents} prickles={eventPrickles} timeZone={timeZone} />
        )}

        {!hasUpcoming && <p className="mb-8 text-sm text-slate-600 dark:text-slate-400">No upcoming {EMPTY_LABELS[filter]} scheduled yet.</p>}

        {past.length > 0 && (
          <section aria-label="Past" className="mb-8">
            <SectionHeading>Past</SectionHeading>
            <div className="@container">
              <div className="grid grid-cols-1 @pair:grid-cols-2 @columns:grid-cols-3 gap-4">
                {past.map((event) => (
                  <EventCard key={event.id} event={event} artClass="h-20" />
                ))}
              </div>
            </div>
          </section>
        )}
        {past.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-400">No past {EMPTY_LABELS[filter]} yet.</p>}
      </div>
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

function EventCard({ event, artClass }: { event: EventRow; artClass: string }) {
  const where = locationDisplay(event.location);
  const needsSignUp = !!event.registration && event.registration !== "none";
  return (
    <Link data-track="events-event-location-event-focus"
      href={`/events/${event.slug}`}
      className="block bg-white dark:bg-slate-900 rounded-lg shadow overflow-hidden hover:shadow-md transition-shadow"
    >
      <EventArt
        eventType={event.event_type}
        icon={event.badge_icon}
        coverUrl={event.cover_photo_id ? `/api/events/${event.id}/photos/${event.cover_photo_id}` : null}
        className={artClass}
      />
      <div className="p-4">
        <p className="text-xs text-slate-600 dark:text-slate-400 uppercase tracking-wide">
          {EVENT_TYPE_LABELS[event.event_type as EventType] || event.event_type}
          {needsSignUp ? " · Sign-up required" : ""}
        </p>
        <h3 className="font-semibold mt-0.5">{event.title}</h3>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          {fmtDateRange(event.starts_at, event.ends_at)}
          {where ? ` · ${where.text}` : ""}
        </p>
        {event.focus && <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{event.focus}</p>}
      </div>
    </Link>
  );
}

// The regular, drop-in sessions (Pitch Prickle, Goal Review...): a quiet list, since they ask nothing of a member.
function SessionsSection({ events, prickles, timeZone }: { events: EventRow[]; prickles: EventPrickle[]; timeZone: string }) {
  const withSecondary = useWithSecondaryTime();
  return (
    <section aria-label="Sessions" className="mb-8 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <SectionHeading>Sessions</SectionHeading>
      <ul>
        {events.map((e) => (
          <li key={e.id}>
            <Link data-track="events-open-session"
              href={`/events/${e.slug}`}
              className="flex items-center justify-between gap-4 py-2.5 border-b border-slate-200/70 dark:border-slate-800 last:border-0 -mx-2 px-2 rounded hover:bg-slate-50 dark:hover:bg-slate-800/50"
            >
              <p className="text-sm font-medium truncate">{e.title}</p>
              <p className="text-xs text-slate-600 dark:text-slate-400 flex-shrink-0 text-right">{fmtDateRange(e.starts_at, e.ends_at)}</p>
            </Link>
          </li>
        ))}
        {prickles.map((p) => (
          <li key={p.id}>
            <Link data-track="events-open-prickle"
              href={`/prickles/${p.id}`}
              className="flex items-center justify-between gap-4 py-2.5 border-b border-slate-200/70 dark:border-slate-800 last:border-0 -mx-2 px-2 rounded hover:bg-slate-50 dark:hover:bg-slate-800/50"
            >
              <div className="min-w-0">
                {p.title && p.title !== p.typeName && (
                  <p className="text-xs text-slate-600 dark:text-slate-400 uppercase tracking-wide truncate">{p.typeName}</p>
                )}
                <p className="text-sm font-medium truncate">{p.title || p.typeName}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  {p.hostName ? `Hosted by ${hostShortName(p.hostName)}` : "No host listed"}
                </p>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 flex-shrink-0 text-right">
                {withSecondary(fmtPrickleTime(p.startTime, timeZone), p.startTime, timeZone)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
