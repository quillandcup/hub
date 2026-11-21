"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-renders the server page (`router.refresh()`, so scroll position and client state stay) every `everyMs`
 * while the tab is showing. For data Realtime can't announce (service role only tables); `LiveRefresh` is
 * the one for rows the viewer can read. Renders nothing.
 */
export default function LivePoll({ everyMs }: { everyMs: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => clearInterval(id);
  }, [everyMs, router]);

  return null;
}
