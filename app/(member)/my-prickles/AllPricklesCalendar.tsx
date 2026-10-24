"use client";

import { useMemo, useState } from "react";
import CalendarWeekView, { type Prickle } from "@/components/CalendarWeekView";
import CalendarScrollContainer from "@/components/CalendarScrollContainer";
import { clock } from "@/lib/clock";
import { sundayOnOrBefore } from "@/lib/org-week";
import type { PrickleInstance } from "@/lib/prickle-schedule";

/**
 * The Sunday starting the week that contains `instant`, as seen in `timeZone` (the zone the calendar
 * displays), held as a UTC-midnight Date so only its UTC fields mean anything. The host's zone
 * never enters, so the current week is right for a viewer whatever their machine's zone.
 */
function startOfWeek(instant: Date, timeZone: string): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
  return new Date(`${sundayOnOrBefore(ymd)}T00:00:00Z`);
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setUTCDate(d.getUTCDate() + days);
  return next;
}

/** Picking recurring slots to commit to: clicking a prickle toggles its whole weekly slot. */
export interface CalendarSlotSelection {
  selected: ReadonlySet<string>;
  /** Slots that can be committed to (on the upcoming schedule); others' blocks aren't clickable. */
  selectable: ReadonlySet<string>;
  onToggle: (seriesKey: string) => void;
}

export default function AllPricklesCalendar({
  instances,
  timeZone,
  upcomingWindowDays,
  lookbackDays,
  selection,
}: {
  instances: PrickleInstance[];
  timeZone: string;
  upcomingWindowDays: number;
  lookbackDays: number;
  selection?: CalendarSlotSelection;
}) {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const thisWeekStart = useMemo(() => startOfWeek(new Date(), timeZone), [timeZone]);
  const [weekStart, setWeekStart] = useState<Date>(thisWeekStart);

  const types = useMemo(() => {
    const seen = new Map<string, string>();
    for (const i of instances) seen.set(i.typeId ?? "notype", i.typeName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [instances]);

  const filtered = typeFilter === "all" ? instances : instances.filter((i) => (i.typeId ?? "notype") === typeFilter);

  const prickles: Prickle[] = filtered.map((i) => ({
    id: i.id,
    host: i.hostName ?? "",
    host_id: i.hostId ?? undefined,
    start_time: i.startTime,
    end_time: i.endTime,
    prickle_type: i.typeName,
    attendance_count: 0,
  }));

  const seriesById = new Map(filtered.map((i) => [i.id, i.seriesKey]));
  // Every occurrence of a picked slot is highlighted, so the member sees the whole weekly pattern.
  const selectedPrickleIds = selection
    ? new Set(filtered.filter((i) => selection.selected.has(i.seriesKey)).map((i) => i.id))
    : undefined;
  const handlePrickleClick = selection
    ? (p: Prickle) => {
        const key = seriesById.get(p.id);
        if (key && selection.selectable.has(key)) selection.onToggle(key);
      }
    : undefined;

  const maxWeekStart = startOfWeek(new Date(clock.now() + upcomingWindowDays * 86_400_000), timeZone);
  // First full week inside the lookback window -- the week the cutoff falls in would be half empty.
  const minWeekStart = addDays(startOfWeek(new Date(clock.now() - lookbackDays * 86_400_000), timeZone), 7);
  const isPrevDisabled = weekStart <= minWeekStart;
  const isNextDisabled = weekStart >= maxWeekStart;

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button data-track="all-prickles-calendar-prev"
            type="button"
            onClick={() => setWeekStart((d) => addDays(d, -7))}
            disabled={isPrevDisabled}
            className="px-2.5 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded-lg text-slate-600 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <button data-track="all-prickles-calendar-this-week"
            type="button"
            onClick={() => setWeekStart(thisWeekStart)}
            className="px-2.5 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded-lg text-slate-600 dark:text-slate-300"
          >
            This Week
          </button>
          <button data-track="all-prickles-calendar-next"
            type="button"
            onClick={() => setWeekStart((d) => addDays(d, 7))}
            disabled={isNextDisabled}
            className="px-2.5 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded-lg text-slate-600 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
        {types.length > 1 && (
          <select data-track="all-prickles-calendar-type-filter"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          >
            <option value="all">All Prickles</option>
            {types.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}
      </div>

      <CalendarScrollContainer prickleStartTimes={prickles.map((p) => p.start_time)} timezone={timeZone}>
        <CalendarWeekView
          prickles={prickles}
          weekStartDate={{ year: weekStart.getUTCFullYear(), month: weekStart.getUTCMonth(), day: weekStart.getUTCDate() }}
          userTimezonePreference={timeZone}
          mode="member"
          showAttendanceDetails={false}
          onPrickleClick={handlePrickleClick}
          selectedPrickleIds={selectedPrickleIds}
        />
      </CalendarScrollContainer>
    </div>
  );
}
