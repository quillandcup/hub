"use client";

import { useEffect, useRef } from "react";

function earliestPrickleHour(startTimes: string[], timezone: string): number {
  if (startTimes.length === 0) return 7;
  const tz = timezone === "browser"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : (timezone || "America/New_York");
  let min = 24;
  for (const t of startTimes) {
    const h = parseInt(
      new Date(t).toLocaleTimeString("en-US", { timeZone: tz, hour: "2-digit", hour12: false })
    );
    if (h < min) min = h;
  }
  return min === 24 ? 7 : Math.max(0, min - 3);
}

export default function CalendarScrollContainer({
  children,
  prickleStartTimes,
  timezone,
}: {
  children: React.ReactNode;
  prickleStartTimes: string[];
  timezone: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const scrollToHour = earliestPrickleHour(prickleStartTimes, timezone);
    const target = ref.current.querySelector(`[data-hour="${scrollToHour}"]`);
    if (target) {
      const containerTop = ref.current.getBoundingClientRect().top;
      const targetTop = (target as HTMLElement).getBoundingClientRect().top;
      ref.current.scrollTop = targetTop - containerTop;
    } else {
      ref.current.scrollTop = scrollToHour * 60;
    }
  }, [prickleStartTimes, timezone]);

  return (
    <div ref={ref} className="overflow-auto" style={{ maxHeight: "calc(100vh - 220px)" }}>
      {children}
    </div>
  );
}
