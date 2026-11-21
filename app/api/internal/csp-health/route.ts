import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { clock } from "@/lib/clock";
import { CSP_HEALTH } from "@/lib/config";
import { withCronHeartbeat } from "@/lib/cron-heartbeats";
import { CSP_HEALTH_LOGGER, CSP_HEALTH_TAG, cspHealthEvents, evaluateCspHealth } from "@/lib/csp-health";
import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const maxDuration = 60;

const HOUR_MS = 60 * 60 * 1000;
const FLUSH_TIMEOUT_MS = 5000;

/**
 * The daily Content-Security-Policy health check (lib/csp-health.ts, docs/infrastructure/CSP_ALERTS.md): over the last 24 hours, are
 * there members who load pages but never run our scripts, members who lost the Google cookie they used to have, or
 * browsers too old for nonces plus 'strict-dynamic'? Quiet when all is well; otherwise one Sentry event per failing
 * check (level error, tag csp_health_check=<check>, a fixed fingerprint so a lasting condition stays one issue), with counts
 * and browser names only. A Sentry alert rule (config/sentry.yml) emails about them; nothing goes to Slack.
 *
 * Scheduled daily via Vercel Cron (GET); an admin can run it by opening the URL. Read-only apart from the events.
 * One SQL aggregate (one row per user and user agent) feeds all three checks, so it never reads the request log row by row.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const repos = createRepos(createServiceRoleClient());
  const until = new Date(clock.now());
  const since = new Date(until.getTime() - CSP_HEALTH.windowHours * HOUR_MS);
  const historySince = new Date(since.getTime() - CSP_HEALTH.historyDays * 24 * HOUR_MS);

  let rows;
  try {
    rows = await repos.accessEvents.activityForCspHealth({ since, until, historySince });
  } catch (error) {
    // No heartbeat: a check that could not run is not a healthy run.
    console.error("[csp-health] reading the access log failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not read the access log" }, { status: 500 });
  }

  const health = evaluateCspHealth(rows, CSP_HEALTH);
  const events = cspHealthEvents(health, CSP_HEALTH);
  for (const event of events) {
    Sentry.withScope((scope) => {
      scope.setLevel("error");
      // The alert rule matches on csp_health_check alone; logger and check are for people reading the issue.
      scope.setTags({ [CSP_HEALTH_TAG]: event.check, logger: CSP_HEALTH_LOGGER, check: event.check });
      scope.setFingerprint([CSP_HEALTH_LOGGER, event.check]);
      scope.setExtras(event.extra);
      // Sentry's own `logger` field has no SDK option; set it too, though nothing depends on it.
      scope.addEventProcessor((sentryEvent) => ({ ...sentryEvent, logger: CSP_HEALTH_LOGGER }));
      Sentry.captureMessage(event.message, "error");
    });
  }
  // A serverless function can be frozen as soon as it answers: wait until the events have left.
  if (events.length > 0) await Sentry.flush(FLUSH_TIMEOUT_MS);

  const summary = { alerted: events.length > 0, ...health };
  console.log("[csp-health]", JSON.stringify(summary));
  return withCronHeartbeat("csp-health", NextResponse.json(summary));
}
