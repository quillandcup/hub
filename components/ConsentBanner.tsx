"use client";

/**
 * Minimal Google Consent Mode v2 banner.
 *
 * Only rendered for visitors geo-located (via `x-vercel-ip-country`, see
 * app/layout.tsx) to an EU/EEA/UK country -- everyone else gets `analytics_storage`
 * granted by default (see the inline gtag('consent','default', ...) script in
 * app/layout.tsx) and never sees this banner.
 *
 * The default consent state is set server-side, before gtag.js loads, so this
 * component only needs to handle two things once the page is interactive:
 *  1. Re-apply a previously-stored choice (default consent resets to "denied"
 *     on every fresh page load otherwise).
 *  2. Show Accept/Decline and persist + apply whichever the visitor picks.
 */

import { useEffect, useState } from "react";
import { CONSENT_CHANGE_EVENT, CONSENT_STORAGE_KEY as STORAGE_KEY } from "@/lib/analytics/consent";

type ConsentChoice = "granted" | "denied";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

function applyConsent(choice: ConsentChoice) {
  window.gtag?.("consent", "update", {
    analytics_storage: choice,
    ad_storage: choice,
  });
}

export function ConsentBanner({ needsConsent, optedOut = false }: { needsConsent: boolean; optedOut?: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Opted out of statistics (the switch on /privacy): Google Analytics stays denied and there is nothing to ask.
    if (optedOut) {
      applyConsent("denied");
      return;
    }
    if (!needsConsent) return;

    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // localStorage can throw in private-browsing/blocked-storage contexts --
      // fall back to showing the banner every visit rather than crashing.
    }

    if (stored === "granted" || stored === "denied") {
      applyConsent(stored);
    } else {
      setVisible(true);
    }
  }, [needsConsent, optedOut]);

  if (!visible) return null;

  function choose(choice: ConsentChoice) {
    applyConsent(choice);
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Best-effort persistence -- if storage is unavailable the visitor will
      // just see the banner again next visit.
    }
    // Usage tracking (components/AnalyticsEvents.tsx) follows this choice too.
    window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
    setVisible(false);
  }

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
      <div className="max-w-3xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
        <p className="flex-1">
          We use Google Analytics and our own usage log (which pages and buttons you use, never what
          you type) to understand how Hedgie Hub is used. We only turn them on with your consent.
        </p>
        <div className="flex gap-2 shrink-0">
          <button data-track="consent-banner-decline"
            type="button"
            onClick={() => choose("denied")}
            className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 border border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500 rounded"
          >
            Decline
          </button>
          <button data-track="consent-banner-accept"
            type="button"
            onClick={() => choose("granted")}
            className="px-3 py-1.5 text-sm text-white bg-plum-600 hover:bg-plum-700 rounded"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
