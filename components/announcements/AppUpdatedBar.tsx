"use client";

import { useEffect, useState } from "react";
import { isNearSkewDeadline } from "@/lib/skew-deadline";
import AnnouncementBar from "./AnnouncementBar";

/** How often a tab left in front re-checks its age; a tab brought back to the front checks at once. */
export const CHECK_EVERY_MS = 10 * 60 * 1000;

/** Next's error for an action the running deployment doesn't have: a tab left open across a deploy (the server answers it with a 409). */
export function isStaleActionError(reason: unknown): boolean {
  const e = reason as { name?: unknown; message?: unknown } | null;
  return e?.name === "UnrecognizedActionError" || (typeof e?.message === "string" && e.message.includes("was not found on the server"));
}

type Why = "action" | "old";

/**
 * A tab left open across deploys still runs the old page. Vercel keeps answering it from its own deployment for the
 * Skew Protection maximum age (vercel-project-config.yml), counted from that deployment's creation; after that the
 * first button it presses calls a server action the live deployment doesn't know, Next refuses it
 * (UnrecognizedActionError) and the click does nothing.
 *
 * So the bar speaks twice. Shortly before the deadline (lib/skew-deadline.ts) it asks the member to reload when they
 * are done and to submit their work first, while submitting still works. If an action is refused anyway it says so,
 * as the last resort: what they typed is still on the page, but nothing sends until they reload. It never reloads on
 * its own, which would throw away what they typed. A bar of AnnouncementStack, so it stacks with the others.
 */
export default function AppUpdatedBar() {
  const [why, setWhy] = useState<Why | null>(null);

  useEffect(() => {
    const check = () => {
      // A failed action is the stronger message: don't replace it.
      if (isNearSkewDeadline(Date.now(), process.env.BUILD_TIME, process.env.SKEW_PROTECTION_MAX_AGE_SECONDS)) setWhy((current) => current ?? "old");
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isStaleActionError(event.reason)) setWhy("action");
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };
    check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    window.addEventListener("unhandledrejection", onRejection);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("unhandledrejection", onRejection);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  if (!why) return null;
  const action = { label: "Reload", track: "app_updated_reload", onClick: () => window.location.reload() };
  return why === "action" ? (
    <AnnouncementBar tone="info" action={action}>
      That didn&apos;t go through because the Hub was updated. What you typed is still on this page. Copy anything you want to keep, then reload and try again.
    </AnnouncementBar>
  ) : (
    <AnnouncementBar tone="info" action={action} dismiss={{ dismissKey: "app-updated-old", scope: "session", label: "Not now", track: "app_updated_dismiss" }}>
      The Hub has likely been updated since you opened this page. Reload when you&apos;ve finished what you&apos;re doing, and submit any work first.
    </AnnouncementBar>
  );
}
