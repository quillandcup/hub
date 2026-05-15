"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface AttendanceCalendarProps {
  member: any;
  attendanceRecords: any[];
  timezone: string;
  formatTime: (date: Date) => string;
  formatDate: (date: Date) => string;
}

export default function AttendanceCalendar({
  member,
  attendanceRecords,
  timezone,
  formatTime,
  formatDate,
}: AttendanceCalendarProps) {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(new Date());

  // Group attendance by date
  const attendanceByDate = new Map<string, any[]>();
  attendanceRecords.forEach((record) => {
    const date = new Date(record.join_time);
    const dateKey = date.toLocaleDateString("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    if (!attendanceByDate.has(dateKey)) {
      attendanceByDate.set(dateKey, []);
    }
    attendanceByDate.get(dateKey)!.push(record);
  });

  // Get days in current month
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  // Generate calendar days
  const calendarDays: (Date | null)[] = [];

  // Add empty cells for days before month starts
  for (let i = 0; i < startingDayOfWeek; i++) {
    calendarDays.push(null);
  }

  // Add actual days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    calendarDays.push(new Date(year, month, day));
  }

  const navigateMonth = (direction: number) => {
    setCurrentDate(new Date(year, month + direction, 1));
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

  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const selectedDayAttendance = selectedDay ? getAttendanceForDay(selectedDay) : [];

  return (
    <div className="space-y-6">
      {/* Calendar Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => navigateMonth(-1)}
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
            onClick={() => navigateMonth(1)}
            className="px-3 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            →
          </button>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-2">
        {/* Day headers */}
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div
            key={day}
            className="text-center text-xs font-medium text-slate-600 dark:text-slate-400 py-2"
          >
            {day}
          </div>
        ))}

        {/* Calendar days */}
        {calendarDays.map((date, index) => {
          const attendance = getAttendanceForDay(date);
          const hasAttendance = attendance.length > 0;
          const isSelected = selectedDay && date && selectedDay.toDateString() === date.toDateString();

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
                      {attendance.slice(0, 3).map((record, i) => (
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

      {/* Selected Day Details */}
      {selectedDay && selectedDayAttendance.length > 0 && (
        <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
          <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">
            {formatDate(selectedDay)} ({selectedDayAttendance.length} prickle{selectedDayAttendance.length !== 1 ? "s" : ""})
          </h4>
          <div className="space-y-2">
            {selectedDayAttendance.map((record: any) => {
              const prickle = record.prickles;
              const joinTime = new Date(record.join_time);
              const leaveTime = new Date(record.leave_time);
              const durationMinutes = Math.round((leaveTime.getTime() - joinTime.getTime()) / 60000);

              return (
                <div
                  key={record.id}
                  onClick={() => router.push(`/dashboard/prickles/${prickle.id}`)}
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
                            href={`/dashboard/members/${prickle.host.id}`}
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
  );
}
