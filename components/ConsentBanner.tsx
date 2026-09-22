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

const STORAGE_KEY = "ga-consent";

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

export function ConsentBanner({ needsConsent }: { needsConsent: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
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
  }, [needsConsent]);

  if (!visible) return null;

  function choose(choice: ConsentChoice) {
    applyConsent(choice);
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Best-effort persistence -- if storage is unavailable the visitor will
      // just see the banner again next visit.
    }
    setVisible(false);
  }

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
      <div className="max-w-3xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
        <p className="flex-1">
          We use Google Analytics to understand how Hedgie Hub is used. We only turn it on
          with your consent.
        </p>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={() => choose("denied")}
            className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 border border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500 rounded"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => choose("granted")}
            className="px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
