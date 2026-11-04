"use client";

import { useEffect } from "react";

const RELOADED_AT_KEY = "stale-tab-reloaded-at";
/** One reload per minute at most, so a server that keeps refusing can't put the tab in a reload loop. */
const RELOAD_COOLDOWN_MS = 60_000;

/** Next's error for an action the running deployment doesn't have: a tab left open across a deploy (the server answers it with a 409). */
export function isStaleActionError(reason: unknown): boolean {
  const e = reason as { name?: unknown; message?: unknown } | null;
  return e?.name === "UnrecognizedActionError" || (typeof e?.message === "string" && e.message.includes("was not found on the server"));
}

/**
 * A tab left open across a deploy still runs the old page, and the first button it presses calls a server action the new
 * deployment doesn't know. Next refuses it, and the member's click did nothing. Reload so the next click works on the
 * current page; the member's click still has to be repeated, but the page is no longer broken.
 */
export function StaleTabReload() {
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if (!isStaleActionError(event.reason)) return;
      const last = Number(window.sessionStorage.getItem(RELOADED_AT_KEY) ?? 0);
      if (Date.now() - last < RELOAD_COOLDOWN_MS) return;
      window.sessionStorage.setItem(RELOADED_AT_KEY, String(Date.now()));
      window.location.reload();
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);
  return null;
}
