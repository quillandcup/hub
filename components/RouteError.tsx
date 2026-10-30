"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { SUPPORT_EMAIL } from "@/lib/config";

/**
 * What a route group shows when a page throws. A server error reaches the browser with only a
 * `digest` (the real error is already in Sentry and the Vercel logs under the same digest), so it
 * is shown for staff to quote; an error raised in the browser has none and is reported from here.
 */
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    if (!error.digest) Sentry.captureException(error);
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
