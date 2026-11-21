import { requireAdmin } from "@/lib/supabase/api-auth";
import { triggerCalendarSync, triggerReprocessing } from "@/lib/processing/trigger";
import { pingCronHeartbeat } from "@/lib/cron-heartbeats";
import { NextRequest, NextResponse } from "next/server";
import { APP_URL, isProduction } from "@/lib/config";
import { GoogleCalendarClient } from "@/lib/google-calendar/client";
import { ensureCalendarWatchChannel, type WatchResult } from "@/lib/google-calendar/watch";
import { sweepCancelledEvents } from "@/lib/google-calendar/incremental-sync";
import { getServiceRepos } from "@/lib/data/server";

// Extend timeout for reconciliation jobs
export const maxDuration = 300; // 5 minutes (max for Hobby tier)

/**
 * Daily reconciliation job for calendar events.
 * Thin GET wrapper around triggerCalendarSync so Vercel Cron can invoke it
 * (cron requires GET; the actual logic lives in /api/import/calendar).
 *
 * Scheduled to run daily at 2am via Vercel Cron. It also keeps the Google push channel alive
 * (opens or renews it), which is what makes /api/webhooks/calendar fire within seconds of an
 * edit; this sync stays the guaranteed path when a notification is missed. It also removes events
 * deleted from the calendar outside the watched window (`cancelledSinceDays`).
 */
/** How far back to look for deletions: a week and a day by default (a missed night still gets caught), or `?cancelledSinceDays=N` (1 to 365). */
function cancelledSinceDays(request: NextRequest): number {
  const asked = Number(request.nextUrl.searchParams.get("cancelledSinceDays"));
  return Number.isFinite(asked) && asked >= 1 ? Math.min(Math.floor(asked), 365) : 8;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Independent of the sync: a channel problem must not skip the reconcile, but it must not pass
  // silently either (below), since the heartbeat only pings on success.
  let watch: WatchResult | { action: "skipped"; reason: string } | { action: "failed"; error: string };
  const token = process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN;
  if (!isProduction) {
    watch = { action: "skipped", reason: "only production opens the push channel" };
  } else if (!token) {
    watch = { action: "failed", error: "GOOGLE_CALENDAR_WEBHOOK_TOKEN is not configured" };
  } else {
    try {
      watch = await ensureCalendarWatchChannel({
        repos: getServiceRepos(),
        client: new GoogleCalendarClient(),
        calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
        address: `${APP_URL}/api/webhooks/calendar`,
        token,
      });
    } catch (error: any) {
      console.error("[Reconciliation] Calendar watch channel failed:", error);
      watch = { action: "failed", error: error.message || "Failed to open calendar watch channel" };
    }
  }

  try {
    const result = await triggerCalendarSync({ daysBack: 90, daysForward: 90 });
    // The import above only sees the watched window; a deletion of any other event is found here.
    const cancelled = await sweepCancelledEvents({
      repos: getServiceRepos(),
      client: new GoogleCalendarClient(),
      calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
      sinceDays: cancelledSinceDays(request),
      reprocess: (dateRange) => triggerReprocessing("calendar_events", "bronze", { dateRange }),
    });
    if (watch.action === "failed") {
      return NextResponse.json(
        { error: `Calendar synced, but the push channel failed: ${watch.error}`, watch, ...result },
        { status: 500 }
      );
    }
    await pingCronHeartbeat("reconcile-calendar");

    return NextResponse.json({ success: true, reconciliation: "calendar", watch, cancelled, ...result });
  } catch (error: any) {
    console.error("[Reconciliation] Error in calendar reconciliation:", error);
    return NextResponse.json(
      { error: error.message || "Failed to reconcile calendar" },
      { status: 500 }
    );
  }
}
