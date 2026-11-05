"use client";

import { useEffect, useState } from "react";
import AnnouncementBar from "./AnnouncementBar";

/** Past this, a tab is outside the deployment's Skew Protection window (the project's `skewProtectionMaxAge`, 12 hours), so it may be running an old build. */
export const AWAY_AFTER_MS = 12 * 60 * 60 * 1000;

/** Next's error for an action the running deployment doesn't have: a tab left open across a deploy (the server answers it with a 409). */
export function isStaleActionError(reason: unknown): boolean {
  const e = reason as { name?: unknown; message?: unknown } | null;
  return e?.name === "UnrecognizedActionError" || (typeof e?.message === "string" && e.message.includes("was not found on the server"));
}

type Why = "action" | "away";

/**
 * A tab left open across a deploy still runs the old page. Vercel keeps an old tab's requests on its own
 * deployment for 12 hours; after that, the first button it presses calls a server action the live deployment
 * doesn't know, and Next refuses it (UnrecognizedActionError), so the click did nothing. Say so and offer
 * the reload, rather than reloading under the member, who may have typed something.
 *
 * Shown when an action fails that way, and when a tab comes back to the front after 12 hours or more in the
 * background (before anything is pressed; a deploy in between is likely, not certain, so it says "may").
 * A bar of AnnouncementStack, so it stacks with the others.
 */
export default function AppUpdatedBar() {
  const [why, setWhy] = useState<Why | null>(null);

  useEffect(() => {
    let hiddenAt: number | null = document.visibilityState === "hidden" ? Date.now() : null;
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isStaleActionError(event.reason)) setWhy("action");
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      // A failed action is the stronger message: don't replace it.
      if (away >= AWAY_AFTER_MS) setWhy((current) => current ?? "away");
    };
    window.addEventListener("unhandledrejection", onRejection);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  if (!why) return null;
  const action = { label: "Reload", track: "app_updated_reload", onClick: () => window.location.reload() };
  return why === "action" ? (
    <AnnouncementBar tone="info" action={action}>
      That didn&apos;t go through because the Hub was updated. Reload, then try again.
    </AnnouncementBar>
  ) : (
    <AnnouncementBar tone="info" action={action} dismiss={{ dismissKey: "app-updated-away", scope: "session", label: "Not now", track: "app_updated_dismiss" }}>
      The Hub may have been updated while this tab was in the background. Reload to get the latest.
    </AnnouncementBar>
  );
}
