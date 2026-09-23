import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn:
    process.env.NEXT_PUBLIC_SENTRY_DSN ??
    "https://1909f5f182e68bb97e908d89983eb454@o4512131993501696.ingest.de.sentry.io/4512132010672208",

  // Small member platform, not high traffic — capture all errors but keep
  // performance trace volume modest to control event usage.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.2,

  enableLogs: true,

  integrations: [Sentry.replayIntegration()],

  // Session Replay: sample lightly in general, but always capture sessions
  // that hit an error so we get full repro context for the reports that matter.
  replaysSessionSampleRate: 0.05,
  replaysOnErrorSampleRate: 1.0,
});

// Hook into App Router navigation transitions for client-side tracing.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
