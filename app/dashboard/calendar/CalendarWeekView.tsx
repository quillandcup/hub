"use client";

interface Prickle {
  id: string;
  host: string;
  start_time: string;
  end_time: string;
  prickle_type: string; // Prickle type name from prickle_types table
  attendance_count: number;
}

interface CalendarWeekViewProps {
  prickles: Prickle[];
  weekStart: Date;
}

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
function getPricklePosition(startTime: string, endTime: string) {
  const start = new Date(startTime);
  const end = new Date(endTime);

  const startHour = start.getHours();
  const startMinute = start.getMinutes();
  const endHour = end.getHours();
  const endMinute = end.getMinutes();

  // Calculate top position (in pixels from midnight)
  // Each hour is 60px tall
  const top = (startHour * 60) + (startMinute);

  // Calculate height in pixels
  const durationMinutes = ((endHour - startHour) * 60) + (endMinute - startMinute);
  const height = Math.max(durationMinutes, 30); // Minimum 30px height

  return { top, height };
}

export default function CalendarWeekView({ prickles, weekStart }: CalendarWeekViewProps) {
  // Generate array of 7 days
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + i);
    return date;
  });

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Group prickles by day
  const pricklesByDay = days.map(day => {
    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);

    return prickles.filter(p => {
      const prickleStart = new Date(p.start_time);
      return prickleStart >= dayStart && prickleStart <= dayEnd;
    });
  });

  // Hours to display (6 AM to 11 PM)
  const hours = Array.from({ length: 18 }, (_, i) => i + 6);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow overflow-hidden">
      {/* Legend */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800">
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
                    {dayNames[i]}
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
                        const { top, height } = getPricklePosition(prickle.start_time, prickle.end_time);
                        const adjustedTop = top - (6 * 60); // Adjust for 6 AM start

                        // Skip if outside visible hours
                        if (adjustedTop < 0 || adjustedTop > (18 * 60)) {
                          return null;
                        }

                        return (
                          <div
                            key={prickle.id}
                            className={`absolute left-1 right-1 rounded border-2 p-1.5 overflow-hidden pointer-events-auto cursor-default ${getAttendanceColor(prickle.attendance_count)}`}
                            style={{
                              top: `${adjustedTop}px`,
                              height: `${height}px`,
                            }}
                            title={`${prickle.prickle_type}\nHost: ${prickle.host}\nAttendance: ${prickle.attendance_count}`}
                          >
                            <div className="text-xs font-semibold truncate">
                              {prickle.prickle_type}
                            </div>
                            <div className="text-xs truncate">
                              {new Date(prickle.start_time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                            </div>
                            <div className="text-xs font-bold mt-0.5">
                              {prickle.attendance_count} {prickle.attendance_count === 1 ? "attendee" : "attendees"}
                            </div>
                          </div>
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
