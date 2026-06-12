"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import CalendarWeekView, { type Prickle } from "./CalendarWeekView";
import CalendarScrollContainer from "./CalendarScrollContainer";

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

// dateKey is "MM/DD/YYYY" → "Mon DD, YYYY"
function formatDateKey(dateKey: string): string {
  const [m, d, y] = dateKey.split("/").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Sort dateKeys ("MM/DD/YYYY") ascending by calendar date
function parseDateKey(k: string): number {
  const [m, d, y] = k.split("/").map(Number);
  return new Date(y, m - 1, d).getTime();
}

export default function MemberCalendarClient({
  memberId,
  attendance,
  defaultTimezone,
  memberBasePath = "/members",
  initialView = "month",
}: Props) {
  const router = useRouter();

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
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  // null = default to most recent date with entries
  const [currentListDateKey, setCurrentListDateKey] = useState<string | null>(null);

  useEffect(() => {
    setTimezone(resolvedDefault);
  }, [resolvedDefault]);

  // Reset list date when timezone changes (dateKeys are timezone-dependent)
  useEffect(() => {
    setCurrentListDateKey(null);
  }, [timezone]);

  // --- Attendance by date (for month and list views) ---
  const attendanceByDate = new Map<string, any[]>();
  attendance.forEach((record) => {
    const dateKey = new Date(record.join_time).toLocaleDateString("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    if (!attendanceByDate.has(dateKey)) attendanceByDate.set(dateKey, []);
    attendanceByDate.get(dateKey)!.push(record);
  });

  const sortedDateKeys = [...attendanceByDate.keys()].sort(
    (a, b) => parseDateKey(a) - parseDateKey(b)
  );

  const effectiveListDateKey =
    currentListDateKey ?? sortedDateKeys.at(-1); // default: most recent

  const currentListDateIdx = effectiveListDateKey
    ? sortedDateKeys.indexOf(effectiveListDateKey)
    : -1;

  // --- Week view ---
  const weekEnd = new Date(currentWeekStart);
  weekEnd.setDate(currentWeekStart.getDate() + 7);
  weekEnd.setHours(0, 0, 0, 0);

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const isNextWeekDisabled = new Date(currentWeekStart.getTime() + 7 * 86400000) > todayMidnight;

  // --- Navigation disabled states ---
  const isPrevDisabled = view === "list" && currentListDateIdx <= 0;
  const isNextDisabled =
    (view === "week" && isNextWeekDisabled) ||
    (view === "list" && currentListDateIdx >= sortedDateKeys.length - 1);

  // --- Scroll to active list date ---
  useEffect(() => {
    if (view !== "list" || !effectiveListDateKey) return;
    const id = `list-date-${effectiveListDateKey.replace(/\//g, "-")}`;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [effectiveListDateKey, view]);

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
        // Jump to most recent past date with an entry
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

  // --- Month calendar helpers ---
  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startingDayOfWeek = firstDay.getDay();

  const calendarDays: (Date | null)[] = [];
  for (let i = 0; i < startingDayOfWeek; i++) calendarDays.push(null);
  for (let day = 1; day <= daysInMonth; day++) calendarDays.push(new Date(year, month, day));

  const getAttendanceForDay = (date: Date | null) => {
    if (!date) return [];
    const dateKey = date.toLocaleDateString("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return attendanceByDate.get(dateKey) || [];
  };

  const isToday = (date: Date | null) => {
    if (!date) return false;
    const t = new Date();
    return (
      date.getDate() === t.getDate() &&
      date.getMonth() === t.getMonth() &&
      date.getFullYear() === t.getFullYear()
    );
  };

  const selectedDayAttendance = selectedDay ? getAttendanceForDay(selectedDay) : [];

  const formatTime = (date: Date) =>
    date.toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" });

  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", {
      timeZone: timezone,
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  // --- Week view: deduplicate prickles in the selected week ---
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

  // List view: records grouped by date, descending (most recent first)
  const descendingDateKeys = [...sortedDateKeys].reverse();

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

      {/* Month view */}
      {view === "month" && (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
          <div className="space-y-6">
            <div className="grid grid-cols-7 gap-2">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div
                  key={day}
                  className="text-center text-xs font-medium text-slate-600 dark:text-slate-400 py-2"
                >
                  {day}
                </div>
              ))}
              {calendarDays.map((date, index) => {
                const att = getAttendanceForDay(date);
                const hasAttendance = att.length > 0;
                const isSelected =
                  selectedDay && date && selectedDay.toDateString() === date.toDateString();

                return (
                  <div
                    key={index}
                    onClick={() => date && setSelectedDay(date)}
                    className={`
                      min-h-[80px] p-2 border rounded-lg
                      ${date ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800" : ""}
                      ${isToday(date) ? "border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-950" : "border-slate-200 dark:border-slate-700"}
                      ${isSelected ? "ring-2 ring-blue-500" : ""}
                      ${!date ? "bg-slate-50 dark:bg-slate-900" : "bg-white dark:bg-slate-900"}
                    `}
                  >
                    {date && (
                      <>
                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {date.getDate()}
                        </div>
                        {hasAttendance && (
                          <div className="mt-1 space-y-1">
                            {att.slice(0, 3).map((record) => (
                              <div
                                key={record.id}
                                className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded truncate"
                                title={record.prickles?.prickle_types?.name}
                              >
                                {record.prickles?.prickle_types?.name}
                              </div>
                            ))}
                            {att.length > 3 && (
                              <div className="text-xs text-slate-500 dark:text-slate-400 px-1.5">
                                +{att.length - 3} more
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {selectedDay && selectedDayAttendance.length > 0 && (
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">
                  {formatDate(selectedDay)} ({selectedDayAttendance.length} prickle
                  {selectedDayAttendance.length !== 1 ? "s" : ""})
                </h4>
                <div className="space-y-2">
                  {selectedDayAttendance.map((record: any) => {
                    const prickle = record.prickles;
                    const joinTime = new Date(record.join_time);
                    const leaveTime = new Date(record.leave_time);
                    const durationMinutes = Math.round(
                      (leaveTime.getTime() - joinTime.getTime()) / 60000
                    );
                    return (
                      <div
                        key={record.id}
                        onClick={() => router.push(`/prickles/${prickle.id}`)}
                        className="p-3 bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-400 cursor-pointer transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {prickle.host?.id === memberId && "⭐ "}
                              {prickle.prickle_types?.name || "Unknown"}
                            </div>
                            <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                              {formatTime(joinTime)} – {formatTime(leaveTime)} ({durationMinutes}{" "}
                              min)
                            </div>
                            {prickle.host && (
                              <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                Host:{" "}
                                <Link
                                  href={`${memberBasePath}/${prickle.host.id}`}
                                  className="text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {prickle.host.name}
                                </Link>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedDay && selectedDayAttendance.length === 0 && (
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                <p className="text-center text-slate-500 dark:text-slate-400">
                  No attendance recorded for {formatDate(selectedDay)}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Week view */}
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

      {/* List view: grouped by date, descending */}
      {view === "list" && (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
          {attendance.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Prickle Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Time
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Duration
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Host
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {descendingDateKeys.map((dateKey) => {
                    const records = attendanceByDate.get(dateKey) || [];
                    const isActive = dateKey === effectiveListDateKey;
                    return (
                      <>
                        <tr
                          key={`header-${dateKey}`}
                          id={`list-date-${dateKey.replace(/\//g, "-")}`}
                        >
                          <td
                            colSpan={4}
                            className={`px-6 py-2 text-sm font-semibold border-t-2 ${
                              isActive
                                ? "border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-900 dark:text-blue-100"
                                : "border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            {formatDateKey(dateKey)}
                          </td>
                        </tr>
                        {records.map((record: any) => {
                          const prickle = record.prickles;
                          const joinTime = new Date(record.join_time);
                          const leaveTime = new Date(record.leave_time);
                          const durationMinutes = Math.round(
                            (leaveTime.getTime() - joinTime.getTime()) / 60000
                          );
                          return (
                            <tr
                              key={record.id}
                              className="hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                              onClick={() => router.push(`/prickles/${prickle.id}`)}
                            >
                              <td className="px-6 py-4">
                                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                                  {prickle.host?.id === memberId && "⭐ "}
                                  {prickle.prickle_types?.name || "Unknown"}
                                </div>
                              </td>
                              <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                                {formatTime(joinTime)} – {formatTime(leaveTime)}
                              </td>
                              <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                                {durationMinutes} min
                              </td>
                              <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                                {prickle.host ? (
                                  <Link
                                    href={`${memberBasePath}/${prickle.host.id}`}
                                    className="text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {prickle.host.name}
                                  </Link>
                                ) : (
                                  "None"
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400">
              No attendance records for this member
            </div>
          )}
        </div>
      )}
    </div>
  );
}
