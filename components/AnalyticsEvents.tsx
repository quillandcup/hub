"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { startAutocapture } from "@/lib/analytics/autocapture";
import { startImpressions } from "@/lib/analytics/impressions";
import { flush, setTrackingEnabled, track, trackWhenEnabled } from "@/lib/analytics/client";
import { readAttribution, stripAttribution } from "@/lib/notifications/attribution";
import { useEventsAllowed } from "@/lib/analytics/use-events-allowed";
import { templateRoute } from "@/lib/analytics/route";

/**
 * Turns on usage tracking (lib/analytics/client.ts) for a signed-in visitor once consent allows
 * it: reports page views, clicks and which named controls were seen, and sends what is queued when the tab is hidden. Renders
 * nothing. Mounted once in app/layout.tsx.
 */
export function AnalyticsEvents({ needsConsent, optedOut = false }: { needsConsent: boolean; optedOut?: boolean }) {
  const pathname = usePathname();
  const allowed = useEventsAllowed(needsConsent, optedOut);

  useEffect(() => {
    setTrackingEnabled(allowed);
    if (!allowed) return;
    const stopClicks = startAutocapture();
    const stopImpressions = startImpressions();
    const onHidden = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onHidden);
    return () => {
      stopClicks();
      stopImpressions();
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onHidden);
    };
  }, [allowed]);

  // Arrived through a link in a notification (lib/notifications/attribution.ts): record which one, once,
  // and take the tag off the address. It is stripped whether or not tracking is on, so the address
  // stays clean; recording waits for tracking, and is dropped, never held, if it never starts.
  useEffect(() => {
    const attribution = readAttribution(window.location.search);
    if (!attribution) return;
    const { pathname: path, search, hash } = window.location;
    window.history.replaceState(window.history.state, "", path + stripAttribution(search) + hash);
    return trackWhenEnabled("notification_opened", attribution);
  }, []);

  useEffect(() => {
    if (!allowed || !pathname) return;
    track("page_viewed", { route: templateRoute(pathname) ?? "/" });
  }, [allowed, pathname]);

  return null;
}
