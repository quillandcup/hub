import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { triggerReprocessing } from "@/lib/processing/trigger";

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

    // Verify channel token if configured
    const expectedToken = process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN;
    if (expectedToken && channelToken !== expectedToken) {
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

    // For event changes, we need to fetch the latest calendar data
    // We can't rely on the webhook payload alone as it doesn't contain the full event
    // Instead, we trigger a sync which will UPSERT the latest state from Google Calendar

    // Determine date range for sync (default to last 30 days + next 90 days)
    // This ensures we catch any changed events in our typical sync window
    const now = new Date();
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - 30);
    const toDate = new Date(now);
    toDate.setDate(toDate.getDate() + 90);

    // Trigger calendar sync asynchronously (fire-and-forget)
    // Don't await to ensure we respond quickly to webhook
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    fetch(`${baseUrl}/api/sync/calendar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Use service role key to bypass auth (internal processing)
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        daysBack: 30,
        daysForward: 90,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          console.error("Failed to trigger calendar sync:", response.statusText);
        } else {
          console.log("Calendar sync triggered successfully");
        }
      })
      .catch((error) => {
        console.error("Error triggering calendar sync:", error);
      });

    // Return 200 OK immediately (webhook expects fast response)
    return NextResponse.json({
      received: true,
      resourceState,
      channelId,
      triggered: "calendar_sync",
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
