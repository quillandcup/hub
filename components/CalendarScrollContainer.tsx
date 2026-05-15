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
      const target = ref.current.querySelector(`[data-hour="${scrollToHour}"]`);
      if (target) {
        const containerTop = ref.current.getBoundingClientRect().top;
        const targetTop = (target as HTMLElement).getBoundingClientRect().top;
        ref.current.scrollTop = targetTop - containerTop;
      } else {
        ref.current.scrollTop = scrollToHour * 60;
      }
    }
  }, [scrollToHour]);

  return (
    <div ref={ref} className="overflow-auto" style={{ maxHeight: "calc(100vh - 220px)" }}>
      {children}
    </div>
  );
}
