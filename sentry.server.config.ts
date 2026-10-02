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

  // Off on purpose: this attaches the Node inspector ("Debugger listening on
  // ws://...") and on Vercel it added ~800ms to every server render
  // (/login went from ~850ms to ~40ms of function time with it disabled).
  includeLocalVariables: false,

  enableLogs: true,
});
