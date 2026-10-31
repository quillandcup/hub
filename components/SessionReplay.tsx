"use client";

import { useEffect, useRef } from "react";
import * as Sentry from "@sentry/nextjs";
import { useEventsAllowed } from "@/lib/analytics/use-events-allowed";

/** Share of page loads recorded in full while usage statistics are allowed. */
export const REPLAY_SESSION_SAMPLE_RATE = 0.05;

/**
 * Session Replay (integration and error rate in instrumentation-client.ts) always keeps the last moments in the
 * browser's memory and uploads them only if an error happens, so a bug can be fixed from what was on screen. That
 * needs no answer to the consent banner and is not turned off by "Leave me out of statistics"; the privacy page says so.
 *
 * Recording ordinary sessions is the usage-statistics part: a small sample, and only where those are allowed (the same
 * consent and opt-out rules as usage events). If the visitor withdraws mid-visit a full recording stops at once and
 * falls back to error-only; it never starts within the same visit. Renders nothing.
 */
export function SessionReplay({ needsConsent, optedOut = false }: { needsConsent: boolean; optedOut?: boolean }) {
  const allowed = useEventsAllowed(needsConsent, optedOut);
  // Chosen once per page load, so a change of consent doesn't re-roll the dice.
  const sampled = useRef<boolean | null>(null);
  const recordingInFull = useRef(false);

  useEffect(() => {
    const replay = Sentry.getReplay();
    if (!replay) return;
    if (allowed) {
      sampled.current ??= Math.random() < REPLAY_SESSION_SAMPLE_RATE;
      if (sampled.current && !recordingInFull.current) {
        recordingInFull.current = true;
        replay.start();
      }
    } else if (recordingInFull.current) {
      recordingInFull.current = false;
      void replay.stop().then(() => replay.startBuffering());
    }
  }, [allowed]);

  return null;
}
