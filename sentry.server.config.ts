import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn:
    process.env.SENTRY_DSN ??
    "https://1909f5f182e68bb97e908d89983eb454@o4512131993501696.ingest.de.sentry.io/4512132010672208",

  // Small member platform, not high traffic — capture all errors but keep
  // performance trace volume modest to control event usage.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.2,

  // Off on purpose: this attaches the Node inspector ("Debugger listening on
  // ws://...") and on Vercel it added ~800ms to every server render
  // (/login went from ~850ms to ~40ms of function time with it disabled).
  includeLocalVariables: false,

  enableLogs: true,
});
