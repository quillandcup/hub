"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Props {
  attendance: any[];
  timezone: string;
  currentMonthDate: Date;
  memberId: string;
  memberBasePath?: string;
}

function shortName(name: string): string {
  const match = name.match(/"([^"]+)"/);
  if (match) return match[1];
  return name.split(" ")[0];
}

function dateKey(date: Date, timezone: string): string {
  return date.toLocaleDateString("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export default function AttendanceMonthGrid({
  attendance,
  timezone,
  currentMonthDate,
  memberId,
  memberBasePath = "/members",
}: Props) {
  const router = useRouter();
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startingDayOfWeek = new Date(year, month, 1).getDay();

  const calendarDays: (Date | null)[] = [];
  for (let i = 0; i < startingDayOfWeek; i++) calendarDays.push(null);
  for (let day = 1; day <= daysInMonth; day++) calendarDays.push(new Date(year, month, day));

  const byDate = new Map<string, any[]>();
  attendance.forEach((record) => {
    const key = dateKey(new Date(record.join_time), timezone);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(record);
  });

  const getDay = (date: Date | null) =>
    date ? (byDate.get(dateKey(date, timezone)) ?? []) : [];

  const isToday = (date: Date | null) => {
    if (!date) return false;
    const t = new Date();
    return (
      date.getDate() === t.getDate() &&
      date.getMonth() === t.getMonth() &&
      date.getFullYear() === t.getFullYear()
    );
  };

  const fmt = (date: Date, opts: Intl.DateTimeFormatOptions) =>
    date.toLocaleString("en-US", { timeZone: timezone, ...opts });

  const formatTime = (d: Date) => fmt(d, { hour: "numeric", minute: "2-digit" });
  const formatDate = (d: Date) =>
    fmt(d, { weekday: "short", year: "numeric", month: "short", day: "numeric" });

  const selectedAtt = selectedDay ? getDay(selectedDay) : [];

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
      <div className="space-y-6">
        <div className="grid grid-cols-7 gap-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div
              key={d}
              className="text-center text-xs font-medium text-slate-600 dark:text-slate-400 py-2"
            >
              {d}
            </div>
          ))}
          {calendarDays.map((date, index) => {
            const att = getDay(date);
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
                    {att.length > 0 && (
                      <div className="mt-1 space-y-1">
                        {att.slice(0, 3).map((record) => {
                          const typeName = record.prickles?.prickle_types?.name;
                          const hostName = record.prickles?.host?.name;
                          const label = hostName ? `${typeName} w/ ${shortName(hostName)}` : typeName;
                          return (
                            <div
                              key={record.id}
                              className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded truncate"
                              title={label}
                            >
                              {label}
                            </div>
                          );
                        })}
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

        {selectedDay && selectedAtt.length > 0 && (
          <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
            <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">
              {formatDate(selectedDay)} ({selectedAtt.length} prickle
              {selectedAtt.length !== 1 ? "s" : ""})
            </h4>
            <div className="space-y-2">
              {selectedAtt.map((record: any) => {
                const prickle = record.prickles;
                const joinTime = new Date(record.join_time);
                const leaveTime = new Date(record.leave_time);
                const duration = Math.round((leaveTime.getTime() - joinTime.getTime()) / 60000);
                return (
                  <div
                    key={record.id}
                    onClick={() => router.push(`/prickles/${prickle.id}`)}
                    className="p-3 bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-400 cursor-pointer transition-colors"
                  >
                    <div className="flex-1">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {prickle.host?.id === memberId && "⭐ "}
                        {prickle.prickle_types?.name || "Unknown"}
                      </div>
                      <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                        {formatTime(joinTime)} – {formatTime(leaveTime)} ({duration} min)
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
                );
              })}
            </div>
          </div>
        )}

        {selectedDay && selectedAtt.length === 0 && (
          <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
            <p className="text-center text-slate-500 dark:text-slate-400">
              No attendance recorded for {formatDate(selectedDay)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
