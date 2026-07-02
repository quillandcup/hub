"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const REFRESH_INTERVAL_MS = 30_000;

export function LiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(() => router.refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [router]);

  return null;
}

export function Countdown({ targetTime, label }: { targetTime: string; label: string }) {
  const [display, setDisplay] = useState("");

  useEffect(() => {
    const update = () => {
      const diff = new Date(targetTime).getTime() - Date.now();
      if (diff <= 0) {
        setDisplay(label === "ends" ? "ending soon" : "starting soon");
        return;
      }
      const totalMinutes = Math.floor(diff / 60_000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      const parts = [];
      if (hours > 0) parts.push(`${hours}h`);
      parts.push(`${minutes}m`);
      setDisplay(`${label} in ${parts.join(" ")}`);
    };
    update();
    const interval = setInterval(update, 10_000);
    return () => clearInterval(interval);
  }, [targetTime, label]);

  return <span>{display}</span>;
}
