"use client";

import { useMemo, useState } from "react";
import CalendarWeekView, { type Prickle } from "@/components/CalendarWeekView";
import CalendarScrollContainer from "@/components/CalendarScrollContainer";
import type { PrickleInstance } from "@/lib/prickle-schedule";

function startOfWeek(d: Date): Date {
  const ws = new Date(d);
  ws.setDate(d.getDate() - d.getDay());
  ws.setHours(0, 0, 0, 0);
  return ws;
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(d.getDate() + days);
  return next;
}

export default function AllPricklesCalendar({
  instances,
  timeZone,
  upcomingWindowDays,
}: {
  instances: PrickleInstance[];
  timeZone: string;
  upcomingWindowDays: number;
}) {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const thisWeekStart = useMemo(() => startOfWeek(new Date()), []);
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

  const maxWeekStart = startOfWeek(addDays(new Date(), upcomingWindowDays));
  const isPrevDisabled = weekStart <= thisWeekStart;
  const isNextDisabled = weekStart >= maxWeekStart;

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWeekStart((d) => addDays(d, -7))}
            disabled={isPrevDisabled}
            className="px-2.5 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded-lg text-slate-600 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(thisWeekStart)}
            className="px-2.5 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded-lg text-slate-600 dark:text-slate-300"
          >
            This Week
          </button>
          <button
            type="button"
            onClick={() => setWeekStart((d) => addDays(d, 7))}
            disabled={isNextDisabled}
            className="px-2.5 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded-lg text-slate-600 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
        {types.length > 1 && (
          <select
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
          weekStartDate={{ year: weekStart.getFullYear(), month: weekStart.getMonth(), day: weekStart.getDate() }}
          userTimezonePreference={timeZone}
          mode="member"
          showAttendanceDetails={false}
        />
      </CalendarScrollContainer>
    </div>
  );
}
