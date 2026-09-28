// Checkly heartbeat monitors for every scheduled job (Vercel Cron in vercel.json, plus the
// Supabase pg_cron job that polls the pre-prickle nudge route). Each job pings its heartbeat
// URL after a successful run; Checkly alerts when a ping doesn't arrive within period + grace,
// which catches both failed runs and runs that never fired.
//
// __checks__/cron-heartbeats.check.ts builds one HeartbeatMonitor per entry here, so this file
// must stay free of Next.js/app imports (the Checkly CLI bundles it).
//
// Checkly assigns each monitor's ping URL on first deploy. After adding a job, deploy the
// checks, copy the new monitor's ping URL into .env.prod under `envVar`, and run
// `npm run env:sync`. Until the var is set, pingCronHeartbeat is a no-op.

type TimeUnit = "seconds" | "minutes" | "hours" | "days";

export interface CronHeartbeat {
  /** Human-readable monitor name in Checkly. */
  readonly name: string;
  /** Route the scheduler calls. For Vercel Cron jobs, this matches the vercel.json `path`. */
  readonly path: string;
  readonly scheduler: "vercel" | "pg_cron";
  /** Env var holding the Checkly ping URL. */
  readonly envVar: string;
  readonly period: number;
  readonly periodUnit: TimeUnit;
  readonly grace: number;
  readonly graceUnit: TimeUnit;
}

// Daily jobs can take up to maxDuration (5 min); an hour of grace absorbs that plus cron jitter.
const daily = { period: 1, periodUnit: "days", grace: 1, graceUnit: "hours" } as const;

export const CRON_HEARTBEATS = {
  "reconcile-calendar": {
    name: "Cron: calendar reconciliation (daily 02:00 UTC)",
    path: "/api/reconcile/calendar",
    scheduler: "vercel",
    envVar: "CHECKLY_HEARTBEAT_RECONCILE_CALENDAR",
    ...daily,
  },
  "reconcile-zoom": {
    name: "Cron: Zoom reconciliation (daily 02:30 UTC)",
    path: "/api/reconcile/zoom",
    scheduler: "vercel",
    envVar: "CHECKLY_HEARTBEAT_RECONCILE_ZOOM",
    ...daily,
  },
  "reconcile-slack": {
    name: "Cron: Slack reconciliation (daily 02:45 UTC)",
    path: "/api/reconcile/slack",
    scheduler: "vercel",
    envVar: "CHECKLY_HEARTBEAT_RECONCILE_SLACK",
    ...daily,
  },
  "reconcile-members": {
    name: "Cron: member reconciliation (daily 03:00 UTC)",
    path: "/api/reconcile/members",
    scheduler: "vercel",
    envVar: "CHECKLY_HEARTBEAT_RECONCILE_MEMBERS",
    ...daily,
  },
  "reconcile-logins": {
    name: "Cron: login activity mirror (daily 03:15 UTC)",
    path: "/api/reconcile/logins",
    scheduler: "vercel",
    envVar: "CHECKLY_HEARTBEAT_RECONCILE_LOGINS",
    ...daily,
  },
  "pre-prickle-nudges": {
    name: "Cron: pre-prickle nudges (every 5 min, pg_cron)",
    path: "/api/internal/nudges/pre-prickle",
    scheduler: "pg_cron",
    envVar: "CHECKLY_HEARTBEAT_PRE_PRICKLE_NUDGES",
    // Two or three missed polls in a row is a real outage; one is a blip.
    period: 5,
    periodUnit: "minutes",
    grace: 15,
    graceUnit: "minutes",
  },
} as const satisfies Record<string, CronHeartbeat>;

export type CronHeartbeatJob = keyof typeof CRON_HEARTBEATS;

/**
 * Tells Checkly the job ran. Never throws: a monitoring hiccup must not fail the job itself
 * (a missed ping just shows up as an alert, which is the safe direction).
 */
export async function pingCronHeartbeat(job: CronHeartbeatJob): Promise<void> {
  const url = process.env[CRON_HEARTBEATS[job].envVar];
  if (!url) return;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) console.warn(`[Heartbeat] ${job} ping returned ${res.status}`);
  } catch (error) {
    console.warn(`[Heartbeat] ${job} ping failed:`, error);
  }
}

/** Pings the job's heartbeat when `response` is a success, then returns it unchanged. */
export async function withCronHeartbeat<R extends Response>(job: CronHeartbeatJob, response: R): Promise<R> {
  if (response.ok) await pingCronHeartbeat(job);
  return response;
}
