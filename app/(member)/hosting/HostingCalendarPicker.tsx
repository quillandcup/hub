"use client";

import { useEffect, useState } from "react";
import CalendarWeekView, { type SlotClick } from "@/components/CalendarWeekView";
import { getHostingCalendarContext, type HostingCalendarContext } from "./actions";

interface Props {
  month: string; // "YYYY-MM-01"
  onPick: (slot: SlotClick) => void;
  selectedSlot?: SlotClick | null;
}

interface WeekStart {
  year: number;
  month: number; // zero-indexed, matches CalendarWeekView's weekStartDate
  day: number;
}

function startOfWeek(date: Date): WeekStart {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay());
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
}

function addDays(week: WeekStart, delta: number): WeekStart {
  const d = new Date(week.year, week.month, week.day + delta);
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
}

const EMPTY_CONTEXT: HostingCalendarContext = { prickles: [], proposedSlots: [] };

export default function HostingCalendarPicker({ month, onPick, selectedSlot }: Props) {
  const monthDate = new Date(`${month}T00:00:00Z`);
  const firstOfMonthLocal = new Date(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), monthDate.getUTCDate());

  const [weekStart, setWeekStart] = useState<WeekStart>(() => startOfWeek(firstOfMonthLocal));
  const [context, setContext] = useState<HostingCalendarContext>(EMPTY_CONTEXT);
  const [loading, setLoading] = useState(true);

  // Reset to the month's first week whenever the caller switches which month
  // we're requesting (current month <-> next month).
  useEffect(() => {
    setWeekStart(startOfWeek(firstOfMonthLocal));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getHostingCalendarContext(month).then((result) => {
      if (!cancelled) {
        setContext(result);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const weekLabel = (() => {
    const start = new Date(weekStart.year, weekStart.month, weekStart.day);
    const end = new Date(weekStart.year, weekStart.month, weekStart.day + 6);
    const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${fmt(start)} – ${fmt(end)}`;
  })();

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm">
          Click an open slot to fill in the fields below. Dashed blocks are other hedgies&apos; proposed or confirmed
          slots — times shown in Eastern.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            className="px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            ← Prev
          </button>
          <span className="text-sm text-slate-700 dark:text-slate-300 min-w-[9rem] text-center">{weekLabel}</span>
          <button
            type="button"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            className="px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Next →
          </button>
        </div>
      </div>

      {loading ? (
        <div className="h-40 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg">
          Loading calendar…
        </div>
      ) : (
        <div className="max-h-[500px] overflow-auto border border-slate-200 dark:border-slate-700 rounded-lg">
          <CalendarWeekView
            prickles={context.prickles}
            proposedSlots={context.proposedSlots}
            weekStartDate={weekStart}
            userTimezonePreference="America/New_York"
            mode="member"
            onSlotClick={onPick}
            selectedSlot={selectedSlot}
          />
        </div>
      )}
    </div>
  );
}
