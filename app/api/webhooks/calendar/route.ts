import { getServiceRepos } from "@/lib/data/server";
import { GoogleCalendarClient } from "@/lib/google-calendar/client";
import { SYNC_WINDOW_DAYS, syncCalendarChanges } from "@/lib/google-calendar/incremental-sync";
import { NextRequest, NextResponse, after } from "next/server";
import { triggerCalendarSync, triggerReprocessing } from "@/lib/processing/trigger";
import { secretsMatch, webhookSecretRequired } from "@/lib/webhook-auth";

// Webhook should respond quickly
export const maxDuration = 60;

/**
 * Google Calendar Webhook Handler
 *
 * Receives push notifications from Google Calendar when events change.
 * UPSERTS to Bronze layer (idempotent) and triggers Silver processing.
 *
 * Google Calendar Push Notifications:
 * https://developers.google.com/calendar/api/guides/push
 */
export async function POST(request: NextRequest) {
  try {
    // Verify webhook token
    // Google Calendar uses X-Goog-Channel-Token header for verification
    const channelToken = request.headers.get("x-goog-channel-token");
    const resourceState = request.headers.get("x-goog-resource-state");
    const resourceId = request.headers.get("x-goog-resource-id");
    const channelId = request.headers.get("x-goog-channel-id");

    console.log("Calendar webhook received:", {
      channelToken,
      resourceState,
      resourceId,
      channelId,
    });

    // Validate required headers
    if (!channelId || !resourceState) {
      console.error("Missing required webhook headers");
      return NextResponse.json(
        { error: "Invalid webhook payload" },
        { status: 400 }
      );
    }

    // Verify the channel token Google echoes back (set when the watch channel was created).
    // Deployed builds reject every request while the token is unset, so a missing env var
    // can't leave this endpoint open to anyone who finds the URL.
    const expectedToken = process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN;
    if (!expectedToken && webhookSecretRequired()) {
      console.error("GOOGLE_CALENDAR_WEBHOOK_TOKEN is not configured; rejecting calendar webhook");
      return NextResponse.json(
        { error: "Webhook not configured" },
        { status: 401 }
      );
    }
    if (expectedToken && !secretsMatch(expectedToken, channelToken)) {
      console.error("Invalid Google Calendar webhook token");
      return NextResponse.json(
        { error: "Invalid token" },
        { status: 401 }
      );
    }

    // Google Calendar sends different resource states:
    // - "sync": Initial sync when watch is established
    // - "exists": Event was created/updated
    // - "not_exists": Event was deleted
    if (resourceState === "sync") {
      // Acknowledge sync notification without processing
      console.log("Calendar sync notification acknowledged");
      return NextResponse.json({ received: true });
    }

    // The notification says only that something changed, not what. Fetch what changed since the
    // last sync (not the whole window) and reprocess just the dates it touches. Notifications that
    // arrive while a sync runs coalesce into one rerun. Wrapped in after() so Vercel keeps the
    // function alive until it finishes instead of tearing it down once the response is sent (see
    // docs/TODO.md Bug Fixes for the 2-month Slack webhook data-loss incident this pattern avoids).
    // The nightly reconcile (full sync) is the guaranteed path if any of this fails.
    after(async () => {
      try {
        const result = await syncCalendarChanges({
          repos: getServiceRepos(),
          client: new GoogleCalendarClient(),
          calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
          fullSync: () => triggerCalendarSync({ daysBack: SYNC_WINDOW_DAYS.back, daysForward: SYNC_WINDOW_DAYS.forward }),
          reprocess: (dateRange) => triggerReprocessing("calendar_events", "bronze", { dateRange }),
        });
        console.log("Calendar sync from webhook:", JSON.stringify(result));
      } catch (error) {
        console.error("Error syncing calendar from webhook:", error);
      }
    });

    // Return 200 OK immediately (webhook expects fast response)
    return NextResponse.json({
      received: true,
      resourceState,
      channelId,
      triggered: "calendar_sync_incremental",
    });
  } catch (error: any) {
    console.error("Error processing calendar webhook:", error);

    // Still return 200 to avoid webhook retries on our internal errors
    // Log the error for debugging but don't fail the webhook
    return NextResponse.json({
      received: true,
      error: error.message,
    });
  }
}

/**
 * Handle webhook verification (GET request)
 * Google Calendar sends a GET request to verify the webhook endpoint
 */
export async function GET(request: NextRequest) {
  // TODO: Implement proper webhook verification
  // For now, return 200 OK to confirm endpoint is accessible

  console.log("Calendar webhook verification request");

  return NextResponse.json({
    message: "Calendar webhook endpoint ready",
    verified: true,
  });
}
