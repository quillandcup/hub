"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "UTC", label: "UTC" },
];

interface MemberAttendanceViewProps {
  member: { id: string };
  attendanceRecords: any[];
  userTimezonePreference?: string;
  memberBasePath?: string;
  prickleBasePath?: string;
}

export default function MemberAttendanceView({
  member,
  attendanceRecords,
  userTimezonePreference = "browser",
  memberBasePath = "/admin/members",
  prickleBasePath = "/prickles",
}: MemberAttendanceViewProps) {
  const router = useRouter();

  const [detectedTimezone, setDetectedTimezone] = useState<string | null>(null);
  useEffect(() => {
    if (userTimezonePreference === "browser") {
      setDetectedTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
  }, [userTimezonePreference]);

  const defaultTimezone =
    userTimezonePreference === "browser"
      ? detectedTimezone || "America/New_York"
      : userTimezonePreference;

  const [timezone, setTimezone] = useState(defaultTimezone);
  const [view, setView] = useState<"list" | "calendar">("calendar");

  useEffect(() => {
    setTimezone(defaultTimezone);
  }, [defaultTimezone]);

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

  // --- Calendar state ---
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  const calendarDays: (Date | null)[] = [];
  for (let i = 0; i < startingDayOfWeek; i++) calendarDays.push(null);
  for (let day = 1; day <= daysInMonth; day++) calendarDays.push(new Date(year, month, day));

  const attendanceByDate = new Map<string, any[]>();
  attendanceRecords.forEach((record) => {
    const dateKey = new Date(record.join_time).toLocaleDateString("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    if (!attendanceByDate.has(dateKey)) attendanceByDate.set(dateKey, []);
    attendanceByDate.get(dateKey)!.push(record);
  });

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
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const selectedDayAttendance = selectedDay ? getAttendanceForDay(selectedDay) : [];

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-xl font-bold">Attendance History ({attendanceRecords.length})</h2>
          <div className="flex items-center gap-3">
            {/* Timezone selector */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Timezone:</span>
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
              <button
                onClick={() => setView("list")}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  view === "list"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                }`}
              >
                List
              </button>
              <button
                onClick={() => setView("calendar")}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  view === "calendar"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                }`}
              >
                Calendar
              </button>
            </div>
          </div>
        </div>
      </div>

      {attendanceRecords.length > 0 ? (
        <div className="p-6">
          {view === "list" ? (
            <div className="overflow-x-auto -mx-6">
              <table className="w-full">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Prickle Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Date
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
                  {attendanceRecords.map((record: any) => {
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
                        onClick={() => router.push(`${prickleBasePath}/${prickle.id}`)}
                      >
                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                            {prickle.host?.id === member.id && "⭐ "}
                            {prickle.prickle_types?.name || "Unknown"}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                          {formatDate(joinTime)}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                          {formatTime(joinTime)} - {formatTime(leaveTime)}
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
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Calendar header */}
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCurrentDate(new Date(year, month - 1, 1))}
                    className="px-3 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    ←
                  </button>
                  <button
                    onClick={() => setCurrentDate(new Date())}
                    className="px-3 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded hover:bg-slate-50 dark:hover:bg-slate-700 text-sm"
                  >
                    Today
                  </button>
                  <button
                    onClick={() => setCurrentDate(new Date(year, month + 1, 1))}
                    className="px-3 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    →
                  </button>
                </div>
              </div>

              {/* Calendar grid */}
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
                  const attendance = getAttendanceForDay(date);
                  const hasAttendance = attendance.length > 0;
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
                              {attendance.slice(0, 3).map((record) => (
                                <div
                                  key={record.id}
                                  className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded truncate"
                                  title={record.prickles?.prickle_types?.name}
                                >
                                  {record.prickles?.prickle_types?.name}
                                </div>
                              ))}
                              {attendance.length > 3 && (
                                <div className="text-xs text-slate-500 dark:text-slate-400 px-1.5">
                                  +{attendance.length - 3} more
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

              {/* Selected day details */}
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
                          onClick={() => router.push(`${prickleBasePath}/${prickle.id}`)}
                          className="p-3 bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-400 cursor-pointer transition-colors"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="font-medium text-slate-900 dark:text-slate-100">
                                {prickle.host?.id === member.id && "⭐ "}
                                {prickle.prickle_types?.name || "Unknown"}
                              </div>
                              <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                                {formatTime(joinTime)} - {formatTime(leaveTime)} ({durationMinutes} min)
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
          )}
        </div>
      ) : (
        <div className="p-12 text-center text-slate-500 dark:text-slate-400">
          No attendance records for this member
        </div>
      )}
    </div>
  );
}
