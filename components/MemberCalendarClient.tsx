"use client";

import { useState, useEffect } from "react";
import CalendarWeekView, { type Prickle } from "./CalendarWeekView";
import CalendarScrollContainer from "./CalendarScrollContainer";
import AttendanceMonthGrid from "./AttendanceMonthGrid";
import AttendanceListTable from "./AttendanceListTable";

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "UTC", label: "UTC" },
];

interface Props {
  memberId: string;
  attendance: any[];
  defaultTimezone: string;
  memberBasePath?: string;
  initialView?: "month" | "week" | "list";
}

function formatWeekRange(start: Date, endExclusive: Date): string {
  const end = new Date(endExclusive);
  end.setDate(end.getDate() - 1);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const s = start.toLocaleDateString("en-US", opts);
  const e = end.toLocaleDateString("en-US", { ...opts, year: "numeric" });
  return `${s} – ${e}`;
}

// dateKey format: "MM/DD/YYYY"
function parseDateKey(k: string): number {
  const [m, d, y] = k.split("/").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function formatDateKey(dateKey: string): string {
  const [m, d, y] = dateKey.split("/").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function MemberCalendarClient({
  memberId,
  attendance,
  defaultTimezone,
  memberBasePath = "/members",
  initialView = "month",
}: Props) {
  const [detectedTimezone, setDetectedTimezone] = useState<string | null>(null);
  useEffect(() => {
    if (defaultTimezone === "browser") {
      setDetectedTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
  }, [defaultTimezone]);

  const resolvedDefault =
    defaultTimezone === "browser" ? detectedTimezone || "America/New_York" : defaultTimezone;

  const [timezone, setTimezone] = useState(resolvedDefault);
  const [view, setView] = useState<"month" | "week" | "list">(initialView);
  const [currentMonthDate, setCurrentMonthDate] = useState(() => new Date());
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const now = new Date();
    const ws = new Date(now);
    ws.setDate(now.getDate() - now.getDay() - 7);
    ws.setHours(0, 0, 0, 0);
    return ws;
  });
  // null = default to most recent date with entries
  const [currentListDateKey, setCurrentListDateKey] = useState<string | null>(null);

  useEffect(() => {
    setTimezone(resolvedDefault);
  }, [resolvedDefault]);

  // Reset list position when timezone changes (dateKeys are timezone-dependent)
  useEffect(() => {
    setCurrentListDateKey(null);
  }, [timezone]);

  // Build sorted date keys for list navigation
  const attendanceByDate = new Map<string, true>();
  attendance.forEach((record) => {
    const key = new Date(record.join_time).toLocaleDateString("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    attendanceByDate.set(key, true);
  });
  const sortedDateKeys = [...attendanceByDate.keys()].sort(
    (a, b) => parseDateKey(a) - parseDateKey(b)
  );

  const effectiveListDateKey = currentListDateKey ?? sortedDateKeys.at(-1);
  const currentListDateIdx = effectiveListDateKey
    ? sortedDateKeys.indexOf(effectiveListDateKey)
    : -1;

  // Week view bounds
  const weekEnd = new Date(currentWeekStart);
  weekEnd.setDate(currentWeekStart.getDate() + 7);
  weekEnd.setHours(0, 0, 0, 0);

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const isNextWeekDisabled = new Date(currentWeekStart.getTime() + 7 * 86400000) > todayMidnight;

  // Navigation disabled states
  const isPrevDisabled = view === "list" && currentListDateIdx <= 0;
  const isNextDisabled =
    (view === "week" && isNextWeekDisabled) ||
    (view === "list" && currentListDateIdx >= sortedDateKeys.length - 1);

  const handlePrev = () => {
    if (view === "month") {
      setCurrentMonthDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
    } else if (view === "week") {
      setCurrentWeekStart((d) => {
        const next = new Date(d);
        next.setDate(d.getDate() - 7);
        return next;
      });
    } else if (view === "list" && currentListDateIdx > 0) {
      setCurrentListDateKey(sortedDateKeys[currentListDateIdx - 1]);
    }
  };

  const handleNext = () => {
    if (view === "month") {
      setCurrentMonthDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
    } else if (view === "week" && !isNextWeekDisabled) {
      setCurrentWeekStart((d) => {
        const next = new Date(d);
        next.setDate(d.getDate() + 7);
        return next;
      });
    } else if (view === "list" && currentListDateIdx < sortedDateKeys.length - 1) {
      setCurrentListDateKey(sortedDateKeys[currentListDateIdx + 1]);
    }
  };

  const handleToday = () => {
    const now = new Date();
    setCurrentMonthDate(now);
    const ws = new Date(now);
    ws.setDate(now.getDate() - now.getDay());
    ws.setHours(0, 0, 0, 0);
    setCurrentWeekStart(ws);
    if (view === "list") {
      const todayKey = now.toLocaleDateString("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      if (sortedDateKeys.includes(todayKey)) {
        setCurrentListDateKey(todayKey);
      } else {
        const pastKeys = sortedDateKeys.filter((k) => parseDateKey(k) <= now.getTime());
        setCurrentListDateKey(pastKeys.at(-1) ?? null);
      }
    }
  };

  const navLabel =
    view === "week"
      ? formatWeekRange(currentWeekStart, weekEnd)
      : view === "month"
        ? currentMonthDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })
        : effectiveListDateKey
          ? formatDateKey(effectiveListDateKey)
          : "";

  // Week view: deduplicate prickles in the selected week
  const seenPrickleIds = new Set<string>();
  const pricklesForWeek: Prickle[] = [];
  for (const record of attendance) {
    const joinTime = new Date(record.join_time);
    if (joinTime < currentWeekStart || joinTime >= weekEnd) continue;
    const prickle = record.prickles as any;
    if (!prickle || seenPrickleIds.has(prickle.id)) continue;
    seenPrickleIds.add(prickle.id);
    pricklesForWeek.push({
      id: prickle.id,
      start_time: prickle.start_time,
      end_time: prickle.end_time,
      prickle_type: prickle.prickle_types?.name ?? "Unknown",
      attendance_count: 1,
      host: "",
    });
  }

  return (
    <div>
      {/* Unified header */}
      <div className="mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold">My Attendance</h1>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Timezone selector */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Timezone:
              </span>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>

            {/* View toggle */}
            <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
              {(["month", "week", "list"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    view === v
                      ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                  }`}
                >
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>

            {/* Navigation: Prev | label | Today | Next (all views) */}
            <div className="flex items-center gap-1">
              <button
                onClick={handlePrev}
                disabled={isPrevDisabled}
                className={`px-3 py-2 rounded-lg transition-colors ${
                  isPrevDisabled
                    ? "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed"
                    : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300"
                }`}
              >
                ←
              </button>
              <span className="px-2 text-sm font-medium text-slate-700 dark:text-slate-300 min-w-[160px] text-center">
                {navLabel}
              </span>
              <button
                onClick={handleToday}
                className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-700 dark:text-slate-300 transition-colors text-sm"
              >
                Today
              </button>
              <button
                onClick={handleNext}
                disabled={isNextDisabled}
                className={`px-3 py-2 rounded-lg transition-colors ${
                  isNextDisabled
                    ? "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed"
                    : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300"
                }`}
              >
                →
              </button>
            </div>
          </div>
        </div>
      </div>

      {view === "month" && (
        <AttendanceMonthGrid
          attendance={attendance}
          timezone={timezone}
          currentMonthDate={currentMonthDate}
          memberId={memberId}
          memberBasePath={memberBasePath}
        />
      )}

      {view === "week" && (
        <CalendarScrollContainer
          prickleStartTimes={pricklesForWeek.map((p) => p.start_time)}
          timezone={timezone}
        >
          <CalendarWeekView
            prickles={pricklesForWeek}
            weekStartDate={{
              year: currentWeekStart.getFullYear(),
              month: currentWeekStart.getMonth(),
              day: currentWeekStart.getDate(),
            }}
            userTimezonePreference={timezone}
            mode="member"
          />
        </CalendarScrollContainer>
      )}

      {view === "list" && (
        <AttendanceListTable
          attendance={attendance}
          timezone={timezone}
          activeListDateKey={effectiveListDateKey}
          memberId={memberId}
          memberBasePath={memberBasePath}
        />
      )}
    </div>
  );
}
