"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { PillFilter, type PillOption } from "@/components/PillFilter";
import { hostShortName } from "@/lib/formatters";
import { useWithSecondaryTime } from "@/components/SecondaryTimezone";
import {
  EVENT_TYPE_LABELS,
  countUpcoming,
  groupEvents,
  primaryFilterOf,
  showsEventPrickles,
  type EventFilter,
  type EventType,
  type PrimaryEventFilter,
  type RetreatFilter,
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
  cover_photo_id: string | null;
}

// Type-only (erased at compile time), so none of lib/event-prickles.ts's server-side
// query code reaches the client bundle. Re-exported for existing importers.
export type { EventPrickle };

// How many prickle events the "All" view highlights before linking to the full list.
const EVENT_PRICKLE_PREVIEW_COUNT = 4;

const EMPTY_LABELS: Record<Exclude<EventFilter, "prickles">, string> = {
  all: "events",
  retreats: "retreats",
  in_person_retreat: "in-person retreats",
  virtual_retreat: "virtual retreats",
  other: "other events",
};

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

  const primary = primaryFilterOf(filter);
  const counts = countUpcoming(events, eventPrickles.length, today);
  const { upcoming, past } = groupEvents(events, filter, today);

  const primaryOptions: PillOption<PrimaryEventFilter>[] = [
    { id: "all", label: "All", count: counts.all },
    { id: "retreats", label: "Retreats", count: counts.retreats },
    { id: "prickles", label: "Prickle events", count: counts.prickles },
    { id: "other", label: "Other events", count: counts.other },
  ];
  const retreatOptions: PillOption<RetreatFilter>[] = [
    { id: "retreats", label: "All retreats" },
    { id: "in_person_retreat", label: "In person", count: counts.in_person_retreat },
    { id: "virtual_retreat", label: "Virtual", count: counts.virtual_retreat },
  ];

  return (
    <div>
      <PillFilter ariaLabel="Event type" options={primaryOptions} value={primary} onChange={setFilter} />
      {primary === "retreats" && (
        <PillFilter
          ariaLabel="Retreat format"
          size="sm"
          className="mt-3"
          options={retreatOptions}
          value={filter as RetreatFilter}
          onChange={setFilter}
        />
      )}

      <div className="mt-6">
        {filter === "prickles" ? (
          <EventPricklesSection prickles={eventPrickles} timeZone={timeZone} />
        ) : (
          <>
            {showsEventPrickles(filter) && eventPrickles.length > 0 && (
              <EventPricklesSection
                prickles={eventPrickles.slice(0, EVENT_PRICKLE_PREVIEW_COUNT)}
                timeZone={timeZone}
                highlighted
                moreCount={Math.max(0, eventPrickles.length - EVENT_PRICKLE_PREVIEW_COUNT)}
                onSeeAll={() => setFilter("prickles")}
              />
            )}
            <EventGrid
              heading="Upcoming"
              events={upcoming}
              empty={`No upcoming ${EMPTY_LABELS[filter]} scheduled yet.`}
            />
            <EventGrid heading="Past" events={past} empty={`No past ${EMPTY_LABELS[filter]} yet.`} />
          </>
        )}
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

function EventGrid({ heading, events, empty }: { heading: string; events: EventRow[]; empty: string }) {
  return (
    <section className="mb-8">
      <SectionHeading>{heading}</SectionHeading>
      {events.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">{empty}</p>
      ) : (
        <div className="@container">
          <div className="grid grid-cols-1 @pair:grid-cols-2 @columns:grid-cols-3 gap-4">
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
        </div>
      )}
    </section>
  );
}

function EventCard({ event }: { event: EventRow }) {
  return (
    <Link data-track="events-event-location-event-focus"
      href={`/events/${event.slug}`}
      className="block bg-white dark:bg-slate-900 rounded-lg shadow overflow-hidden hover:shadow-md transition-shadow"
    >
      <div className="aspect-video bg-slate-100 dark:bg-slate-800">
        {event.cover_photo_id && (
          // eslint-disable-next-line @next/next/no-img-element -- served via the private event-photos proxy route
          <img
            src={`/api/events/${event.id}/photos/${event.cover_photo_id}`}
            alt=""
            className="w-full h-full object-cover"
          />
        )}
      </div>
      <div className="p-4">
        <p className="text-xs text-slate-600 dark:text-slate-400 uppercase tracking-wide">
          {EVENT_TYPE_LABELS[event.event_type as EventType] || event.event_type}
        </p>
        <h3 className="font-semibold mt-0.5">{event.title}</h3>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          {fmtDateRange(event.starts_at, event.ends_at)}
          {event.location ? ` · ${event.location}` : ""}
        </p>
        {event.focus && <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{event.focus}</p>}
      </div>
    </Link>
  );
}

function EventPricklesSection({
  prickles,
  timeZone,
  highlighted = false,
  moreCount = 0,
  onSeeAll,
}: {
  prickles: EventPrickle[];
  timeZone: string;
  highlighted?: boolean;
  moreCount?: number;
  onSeeAll?: () => void;
}) {
  const withSecondary = useWithSecondaryTime();
  return (
    <section
      aria-label="Upcoming prickle events"
      className={`mb-8 rounded-lg border p-4 ${
        highlighted
          ? "border-plum-200 bg-plum-50 dark:border-plum-900 dark:bg-plum-950/40"
          : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
      }`}
    >
      <SectionHeading>Upcoming prickle events</SectionHeading>
      {prickles.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">No prickle events on the calendar right now.</p>
      ) : (
        <ul>
          {prickles.map((p) => (
            <li key={p.id}>
              <Link data-track="events-open-prickle"
                href={`/prickles/${p.id}`}
                className="flex items-center justify-between gap-4 py-2.5 border-b border-slate-200/70 dark:border-slate-800 last:border-0 -mx-2 px-2 rounded hover:bg-white/70 dark:hover:bg-slate-800/50"
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
      )}
      {moreCount > 0 && onSeeAll && (
        <button data-track="events-see-all-event-prickles"
          type="button"
          onClick={onSeeAll}
          className="mt-2 text-sm text-plum-600 dark:text-plum-400 hover:underline"
        >
          See all {prickles.length + moreCount} prickle events →
        </button>
      )}
    </section>
  );
}
