"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Prickle {
  id: string;
  host: string;
  host_id?: string;
  start_time: string;
  end_time: string;
  prickle_type: string; // Prickle type name from prickle_types table
  attendance_count: number;
  host_missing?: boolean;
  host_late?: boolean;
}

interface CalendarWeekViewProps {
  prickles: Prickle[];
  weekStart: Date;
}

// Common timezones for the dropdown
const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "UTC", label: "UTC" },
];

// Define color intensity based on attendance count
function getAttendanceColor(count: number): string {
  if (count === 0) {
    return "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400";
  } else if (count <= 3) {
    return "bg-blue-100 dark:bg-blue-950 text-blue-900 dark:text-blue-100 border-blue-300 dark:border-blue-700";
  } else if (count <= 6) {
    return "bg-blue-200 dark:bg-blue-900 text-blue-900 dark:text-blue-50 border-blue-400 dark:border-blue-600";
  } else if (count <= 10) {
    return "bg-blue-400 dark:bg-blue-700 text-white border-blue-500 dark:border-blue-500";
  } else {
    return "bg-blue-600 dark:bg-blue-600 text-white border-blue-700 dark:border-blue-400";
  }
}

// Get the position and height for a prickle block in the calendar
function getPricklePosition(startTime: string, endTime: string, timezone: string) {
  const start = new Date(startTime);
  const end = new Date(endTime);

  // Convert to target timezone
  const startHour = parseInt(start.toLocaleTimeString("en-US", { timeZone: timezone, hour: "2-digit", hour12: false }));
  const startMinute = parseInt(start.toLocaleTimeString("en-US", { timeZone: timezone, minute: "2-digit" }));
  const endHour = parseInt(end.toLocaleTimeString("en-US", { timeZone: timezone, hour: "2-digit", hour12: false }));
  const endMinute = parseInt(end.toLocaleTimeString("en-US", { timeZone: timezone, minute: "2-digit" }));

  // Calculate top position (in pixels from midnight)
  // Each hour is 60px tall
  const top = (startHour * 60) + (startMinute);

  // Calculate height in pixels
  const durationMinutes = ((endHour - startHour) * 60) + (endMinute - startMinute);
  const height = Math.max(durationMinutes, 30); // Minimum 30px height

  return { top, height };
}

export default function CalendarWeekView({ prickles, weekStart }: CalendarWeekViewProps) {
  // Default to Eastern Time
  const [timezone, setTimezone] = useState("America/New_York");
  const [hoveredPrickle, setHoveredPrickle] = useState<string | null>(null);
  const [showPups, setShowPups] = useState(true);
  const router = useRouter();

  // Filter prickles based on showPups and remove 0-duration prickles
  const filteredPrickles = prickles
    .filter(p => {
      // Filter out 0-duration prickles (someone joined and immediately left)
      const start = new Date(p.start_time).getTime();
      const end = new Date(p.end_time).getTime();
      if (start === end) return false;

      // Filter PUPs if checkbox is unchecked
      if (!showPups && p.prickle_type === "Pop-Up Prickle") return false;

      return true;
    });

  // Generate array of 7 days
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + i);
    return date;
  });

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Group prickles by day (in the selected timezone)
  const pricklesByDay = days.map(day => {
    return filteredPrickles.filter(p => {
      const prickleStart = new Date(p.start_time);
      // Get the date in the selected timezone
      const prickleDateStr = prickleStart.toLocaleDateString("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const dayDateStr = day.toLocaleDateString("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      return prickleDateStr === dayDateStr;
    });
  });

  // Hours to display (full 24 hours: 12 AM to 11 PM)
  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow overflow-hidden">
      {/* Legend */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Attendance:</span>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-blue-100 dark:bg-blue-950 border border-blue-300 dark:border-blue-700"></div>
                <span className="text-xs text-slate-600 dark:text-slate-400">1-3</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-blue-200 dark:bg-blue-900 border border-blue-400 dark:border-blue-600"></div>
                <span className="text-xs text-slate-600 dark:text-slate-400">4-6</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-blue-400 dark:bg-blue-700 border border-blue-500"></div>
                <span className="text-xs text-slate-600 dark:text-slate-400">7-10</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-blue-600 dark:bg-blue-600 border border-blue-700 dark:border-blue-400"></div>
                <span className="text-xs text-slate-600 dark:text-slate-400">11+</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showPups}
                onChange={(e) => setShowPups(e.target.checked)}
                className="w-4 h-4 text-blue-600 bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">Show Pop-Up Prickles</span>
            </label>
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
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="overflow-x-auto">
        <div className="min-w-[1000px]">
          {/* Day Headers */}
          <div className="grid grid-cols-8 border-b border-slate-200 dark:border-slate-800">
            <div className="p-2 bg-slate-50 dark:bg-slate-800"></div>
            {days.map((day, i) => {
              const isToday = day.toDateString() === new Date().toDateString();
              return (
                <div
                  key={i}
                  className={`p-3 text-center border-l border-slate-200 dark:border-slate-800 ${
                    isToday ? "bg-blue-50 dark:bg-blue-950" : "bg-slate-50 dark:bg-slate-800"
                  }`}
                >
                  <div className={`text-sm font-semibold ${isToday ? "text-blue-600 dark:text-blue-400" : "text-slate-700 dark:text-slate-300"}`}>
                    {dayNames[day.getDay()]}
                  </div>
                  <div className={`text-xs ${isToday ? "text-blue-500 dark:text-blue-500" : "text-slate-500 dark:text-slate-400"}`}>
                    {day.getMonth() + 1}/{day.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Time Grid */}
          <div className="relative">
            <div className="grid grid-cols-8">
              {/* Time Labels */}
              <div>
                {hours.map(hour => (
                  <div key={hour} className="h-[60px] border-b border-slate-200 dark:border-slate-800 p-2 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800">
                    {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
                  </div>
                ))}
              </div>

              {/* Day Columns */}
              {days.map((day, dayIndex) => {
                const isToday = day.toDateString() === new Date().toDateString();
                return (
                  <div key={dayIndex} className="relative border-l border-slate-200 dark:border-slate-800">
                    {/* Hour Grid Lines */}
                    {hours.map(hour => (
                      <div
                        key={hour}
                        className={`h-[60px] border-b border-slate-200 dark:border-slate-800 ${
                          isToday ? "bg-blue-50/30 dark:bg-blue-950/20" : ""
                        }`}
                      ></div>
                    ))}

                    {/* Prickle Blocks */}
                    <div className="absolute inset-0 pointer-events-none">
                      {pricklesByDay[dayIndex].map(prickle => {
                        const { top, height } = getPricklePosition(prickle.start_time, prickle.end_time, timezone);
                        const adjustedTop = top; // No adjustment needed for full 24-hour view

                        const startTime = new Date(prickle.start_time).toLocaleTimeString("en-US", {
                          timeZone: timezone,
                          hour: "numeric",
                          minute: "2-digit",
                        });

                        return (
                          <>
                            <div
                              key={prickle.id}
                              className={`absolute left-1 right-1 rounded border-2 p-1.5 overflow-hidden pointer-events-auto cursor-pointer hover:opacity-90 transition-opacity ${getAttendanceColor(prickle.attendance_count)}`}
                              style={{
                                top: `${adjustedTop}px`,
                                height: `${height}px`,
                              }}
                              onClick={() => router.push(`/dashboard/prickles/${prickle.id}`)}
                              onMouseEnter={() => setHoveredPrickle(prickle.id)}
                              onMouseLeave={() => setHoveredPrickle(null)}
                            >
                              <div className="text-xs font-semibold truncate">
                                {prickle.prickle_type}
                                {(prickle.host_missing || prickle.host_late) && " ⚠️"}
                              </div>
                              <div className="text-xs truncate">
                                {startTime}
                              </div>
                              <div className="text-xs font-bold mt-0.5">
                                {prickle.attendance_count} {prickle.attendance_count === 1 ? "attendee" : "attendees"}
                              </div>
                            </div>

                            {/* Styled tooltip - rendered outside overflow-hidden container */}
                            {hoveredPrickle === prickle.id && (
                              <div
                                className="absolute z-50 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-3 py-2 rounded-lg shadow-lg text-xs whitespace-nowrap pointer-events-none"
                                style={{
                                  top: `${adjustedTop}px`,
                                  left: 'calc(100% + 8px)', // Position to the right of the day column
                                }}
                              >
                                <div className="font-semibold mb-1">{prickle.prickle_type}</div>
                                <div>Host: {prickle.host || "none"}</div>
                                <div>Attendance: {prickle.attendance_count}</div>
                                {prickle.host_missing && <div className="text-yellow-400 dark:text-yellow-300 mt-1">⚠️ Host did not attend</div>}
                                {prickle.host_late && <div className="text-yellow-400 dark:text-yellow-300 mt-1">⚠️ Host was late (&gt;5 min)</div>}
                              </div>
                            )}
                          </>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
