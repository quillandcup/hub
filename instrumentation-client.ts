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

  // Session Replay keeps the last moments in memory and uploads them only when an error happens
  // (full repro context for the reports that matter). Recording ordinary sessions, a small sample,
  // is started by components/SessionReplay.tsx and only where usage statistics are allowed.
  integrations: [Sentry.replayIntegration()],
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
});

// Hook into App Router navigation transitions for client-side tracing.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
