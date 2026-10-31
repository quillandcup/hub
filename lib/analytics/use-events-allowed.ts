"use client";

import { useEffect, useState } from "react";
import { CONSENT_CHANGE_EVENT, CONSENT_STORAGE_KEY, eventsAllowed } from "@/lib/analytics/consent";

/**
 * Whether this browser may be recorded for usage statistics right now: the consent rule (lib/analytics/consent.ts)
 * with the banner's stored choice, and "Leave me out of statistics" (lib/analytics/opt-out.ts) winning over any
 * consent. Follows the banner when the visitor changes their answer. Shared by usage events and session replay.
 */
export function useEventsAllowed(needsConsent: boolean, optedOut: boolean): boolean {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const read = () => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(CONSENT_STORAGE_KEY);
      } catch {
        // Blocked storage counts as no answer.
      }
      setAllowed(!optedOut && eventsAllowed(needsConsent, stored));
    };
    read();
    window.addEventListener(CONSENT_CHANGE_EVENT, read);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, read);
  }, [needsConsent, optedOut]);

  return allowed;
}
