"use client";

import { useState, useTransition } from "react";
import { setAnalyticsOptOut } from "./actions";

/**
 * The "leave me out of statistics" switch (see lib/analytics/opt-out.ts). On means left out. Turning
 * it on also removes the usage events already recorded, which is said next to the switch.
 */
export function StatsOptOutSwitch({ initialOptedOut, readOnly }: { initialOptedOut: boolean; readOnly: boolean }) {
  const [optedOut, setOptedOut] = useState(initialOptedOut);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function change(next: boolean) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await setAnalyticsOptOut(next);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setOptedOut(next);
      setMessage(
        next
          ? result.removed > 0
            ? "You're left out. We removed the usage statistics recorded under your account."
            : "You're left out. We record no usage statistics for you."
          : "Usage statistics are on again (subject to the banner, if you're in the EU, EEA or UK).",
      );
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Leave me out of usage statistics</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Stops our usage log and the analytics service counting what you do, and removes what&apos;s recorded so far.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          data-track-ignore
          aria-checked={optedOut}
          aria-label="Leave me out of usage statistics"
          disabled={pending || readOnly}
          onClick={() => change(!optedOut)}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-plum-500 focus:ring-offset-2 ${
            optedOut ? "bg-plum-600" : "bg-slate-300 dark:bg-slate-600"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              optedOut ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>
      {readOnly && (
        <p className="text-sm text-slate-600 dark:text-slate-400">This is the account&apos;s own choice, so it can&apos;t be changed while viewing as a member.</p>
      )}
      {message && (
        <p role="status" className="text-sm text-slate-700 dark:text-slate-300">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
