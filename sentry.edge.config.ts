import * as Sentry from "@sentry/nextjs";

Sentry.init({
  // From env-vars.config.ts. NEXT_PUBLIC_ so the browser bundle can read it too; unset
  // (e.g. local dev without it in .env.local) disables Sentry.
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // production / preview, so events from each environment stay apart (the DSN is shared).
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,

  // Small member platform, not high traffic — capture all errors but keep
  // performance trace volume modest to control event usage.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.2,

  enableLogs: true,
});
