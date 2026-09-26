"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { PillFilter, type PillOption } from "@/components/PillFilter";
import { hostShortName } from "@/lib/formatters";
import {
  EVENT_TYPE_LABELS,
  countUpcoming,
  groupEvents,
  primaryFilterOf,
  showsEducationalPrickles,
  type EventFilter,
  type EventType,
  type PrimaryEventFilter,
  type RetreatFilter,
} from "@/lib/events-filter";

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

export interface EducationalPrickle {
  id: string;
  title: string | null;
  typeName: string;
  hostName: string | null;
  startTime: string;
  endTime: string;
}

// How many educational prickles the "All" view highlights before linking to the full list.
const EDUCATIONAL_PREVIEW_COUNT = 4;

const EMPTY_LABELS: Record<Exclude<EventFilter, "educational">, string> = {
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
  educationalPrickles,
  today,
  timeZone,
}: {
  initialFilter: EventFilter;
  events: EventRow[];
  educationalPrickles: EducationalPrickle[];
  today: string;
  timeZone: string;
}) {
  const [filter, setFilterState] = useState<EventFilter>(initialFilter);
  const setFilter = (next: EventFilter) => {
    setFilterState(next);
    syncUrl(next);
  };

  const primary = primaryFilterOf(filter);
  const counts = countUpcoming(events, educationalPrickles.length, today);
  const { upcoming, past } = groupEvents(events, filter, today);

  const primaryOptions: PillOption<PrimaryEventFilter>[] = [
    { id: "all", label: "All", count: counts.all },
    { id: "retreats", label: "Retreats", count: counts.retreats },
    { id: "educational", label: "Educational prickles", count: counts.educational },
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
        {filter === "educational" ? (
          <EducationalSection prickles={educationalPrickles} timeZone={timeZone} />
        ) : (
          <>
            {showsEducationalPrickles(filter) && educationalPrickles.length > 0 && (
              <EducationalSection
                prickles={educationalPrickles.slice(0, EDUCATIONAL_PREVIEW_COUNT)}
                timeZone={timeZone}
                highlighted
                moreCount={Math.max(0, educationalPrickles.length - EDUCATIONAL_PREVIEW_COUNT)}
                onSeeAll={() => setFilter("educational")}
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
    <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
      {children}
    </h2>
  );
}

function EventGrid({ heading, events, empty }: { heading: string; events: EventRow[]; empty: string }) {
  return (
    <section className="mb-8">
      <SectionHeading>{heading}</SectionHeading>
      {events.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </section>
  );
}

function EventCard({ event }: { event: EventRow }) {
  return (
    <Link
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
        <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          {EVENT_TYPE_LABELS[event.event_type as EventType] || event.event_type}
        </p>
        <h3 className="font-semibold mt-0.5">{event.title}</h3>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          {fmtDateRange(event.starts_at, event.ends_at)}
          {event.location ? ` · ${event.location}` : ""}
        </p>
        {event.focus && <p className="text-sm text-slate-500 dark:text-slate-500 mt-1">{event.focus}</p>}
      </div>
    </Link>
  );
}

function EducationalSection({
  prickles,
  timeZone,
  highlighted = false,
  moreCount = 0,
  onSeeAll,
}: {
  prickles: EducationalPrickle[];
  timeZone: string;
  highlighted?: boolean;
  moreCount?: number;
  onSeeAll?: () => void;
}) {
  return (
    <section
      aria-label="Upcoming educational prickles"
      className={`mb-8 rounded-lg border p-4 ${
        highlighted
          ? "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40"
          : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
      }`}
    >
      <SectionHeading>Upcoming educational prickles</SectionHeading>
      {prickles.length === 0 ? (
        <p className="text-sm text-slate-500">No educational prickles on the calendar right now.</p>
      ) : (
        <ul>
          {prickles.map((p) => (
            <li key={p.id}>
              <Link
                href={`/prickles/${p.id}`}
                className="flex items-center justify-between gap-4 py-2.5 border-b border-slate-200/70 dark:border-slate-800 last:border-0 -mx-2 px-2 rounded hover:bg-white/70 dark:hover:bg-slate-800/50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{p.title || p.typeName}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {p.hostName ? `Hosted by ${hostShortName(p.hostName)}` : "No host listed"}
                  </p>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 flex-shrink-0 text-right">
                  {fmtPrickleTime(p.startTime, timeZone)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {moreCount > 0 && onSeeAll && (
        <button
          type="button"
          onClick={onSeeAll}
          className="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          See all {prickles.length + moreCount} educational prickles →
        </button>
      )}
    </section>
  );
}
