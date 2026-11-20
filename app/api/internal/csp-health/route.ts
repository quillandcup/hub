import { NextRequest, NextResponse } from "next/server";
import { clock } from "@/lib/clock";
import { CSP_HEALTH } from "@/lib/config";
import { withCronHeartbeat } from "@/lib/cron-heartbeats";
import { cspHealthProblems, evaluateCspHealth } from "@/lib/csp-health";
import { createRepos } from "@/lib/data/repos";
import { sendOperationsAlert } from "@/lib/operations-alerts";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const maxDuration = 60;

const HOUR_MS = 60 * 60 * 1000;

/**
 * The daily Content-Security-Policy health check (lib/csp-health.ts, docs/CSP_ALERTS.md): over the last 24 hours, are
 * there members who load pages but never run our scripts, members who lost the Google cookie they used to have, or
 * browsers too old for nonces plus 'strict-dynamic'? Quiet when all is well; otherwise one post to the alerts channel
 * with counts and browser names only.
 *
 * Scheduled daily via Vercel Cron (GET); an admin can run it by opening the URL. Read-only apart from the post.
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
  const problems = cspHealthProblems(health, CSP_HEALTH);
  if (problems.length > 0) await sendOperationsAlert(repos, { type: "csp_health", problems });

  const summary = { alerted: problems.length > 0, ...health };
  console.log("[csp-health]", JSON.stringify(summary));
  return withCronHeartbeat("csp-health", NextResponse.json(summary));
}
