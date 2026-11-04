"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { SUPPORT_EMAIL } from "@/lib/config";

/**
 * What a route group shows when a page throws. A server error reaches the browser with only a
 * `digest` (the real error is in the Vercel logs under that digest and in Sentry as the `digest` tag, see lib/request-error.ts), so it
 * is shown for staff to quote; an error raised in the browser has none and is reported from here.
 */
/**
 * The browser's own words for a request that was cut off (flaky connection, tab put to sleep, navigating away mid-load):
 * Safari says "Error in input stream" or "Load failed", Chrome "Failed to fetch", Firefox "NetworkError...". Not a bug in
 * the page, so it still goes to Sentry but doesn't page #hub-alerts.
 */
export function isTransientNetworkError(error: Error): boolean {
  return error.name === "TypeError" && /^(Error in input stream|Load failed|Failed to fetch|NetworkError)/i.test(error.message);
}

export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    if (error.digest) return;
    Sentry.captureException(error);
    if (isTransientNetworkError(error)) return;
    // Nobody watches Sentry: tell #hub-alerts through the app (a server error is alerted from the server).
    fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: window.location.pathname, message: `${error.name}: ${error.message}` }),
      keepalive: true,
    }).catch(() => {});
  }, [error]);

  return (
    <div role="alert" className="mx-auto max-w-lg p-8 text-center">
      <h1 className="text-xl font-semibold">This page didn&apos;t load</h1>
      <p className="mt-2 text-sm text-gray-600">
        Something went wrong on our side. Trying again usually works; if it doesn&apos;t, email{" "}
        <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>
          {SUPPORT_EMAIL}
        </a>
        {error.digest ? <> and quote <code>{error.digest}</code></> : null}.
      </p>
      <button type="button" onClick={() => retry()} className="mt-4 rounded bg-gray-900 px-4 py-2 text-sm text-white">
        Try again
      </button>
    </div>
  );
}
