import * as Sentry from "@sentry/nextjs";

Sentry.init({
  // From env-vars.config.ts. NEXT_PUBLIC_ so the browser bundle can read it too; unset
  // (e.g. local dev without it in .env.local) disables Sentry.
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

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
