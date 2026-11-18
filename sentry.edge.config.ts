import * as Sentry from "@sentry/nextjs";
import { scrubBreadcrumb, scrubEvent } from "@/lib/sentry-scrub";

Sentry.init({
  // From env-vars.config.ts. NEXT_PUBLIC_ so the browser bundle can read it too; unset
  // (e.g. local dev without it in .env.local) disables Sentry.
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Addresses that are credentials (calendar feed, sign-in links) never leave in an event (lib/sentry-scrub.ts).
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
  // production / preview, so events from each environment stay apart (the DSN is shared).
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,

  // Small member platform, not high traffic — capture all errors but keep
  // performance trace volume modest to control event usage.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.2,
});
