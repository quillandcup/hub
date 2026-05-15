"use client";

import { useEffect, useRef } from "react";

export default function CalendarScrollContainer({
  children,
  scrollToHour,
}: {
  children: React.ReactNode;
  scrollToHour: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = scrollToHour * 60;
    }
  }, [scrollToHour]);

  return (
    <div ref={ref} className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 220px)" }}>
      {children}
    </div>
  );
}
