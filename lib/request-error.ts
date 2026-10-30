import * as Sentry from "@sentry/nextjs";

/**
 * Next's `onRequestError` hook: Sentry's capture, plus the error's `digest` as a `digest` tag. The
 * digest is the number the error page tells people to quote (`components/RouteError.tsx`) and the
 * one on the Vercel log line; Sentry's own issue ids are unrelated, so without the tag a digest
 * from a screenshot can't be searched there (`digest:2853465512`).
 */
export const onRequestError: typeof Sentry.captureRequestError = (error, request, context) => {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return Sentry.withScope((scope) => {
    if (typeof digest === "string" && digest) scope.setTag("digest", digest);
    return Sentry.captureRequestError(error, request, context);
  });
};
