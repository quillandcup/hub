"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { startAutocapture } from "@/lib/analytics/autocapture";
import { startImpressions } from "@/lib/analytics/impressions";
import { flush, setTrackingEnabled, track } from "@/lib/analytics/client";
import { CONSENT_CHANGE_EVENT, CONSENT_STORAGE_KEY, eventsAllowed } from "@/lib/analytics/consent";
import { templateRoute } from "@/lib/analytics/route";

/**
 * Turns on usage tracking (lib/analytics/client.ts) for a signed-in visitor once consent allows
 * it: reports page views, clicks and which named controls were seen, and sends what is queued when the tab is hidden. Renders
 * nothing. Mounted once in app/layout.tsx.
 */
export function AnalyticsEvents({ needsConsent }: { needsConsent: boolean }) {
  const pathname = usePathname();
  const [allowed, setAllowed] = useState(false);

  // Consent: re-read the banner's stored choice, and follow it when the visitor changes it.
  useEffect(() => {
    const read = () => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(CONSENT_STORAGE_KEY);
      } catch {
        // Blocked storage counts as no answer.
      }
      setAllowed(eventsAllowed(needsConsent, stored));
    };
    read();
    window.addEventListener(CONSENT_CHANGE_EVENT, read);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, read);
  }, [needsConsent]);

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

  useEffect(() => {
    if (!allowed || !pathname) return;
    track("page_viewed", { route: templateRoute(pathname) ?? "/" });
  }, [allowed, pathname]);

  return null;
}
