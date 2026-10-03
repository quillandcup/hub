import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse, after } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { triggerZoomImport } from "@/lib/processing/trigger";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { parseParticipantEvent } from "@/lib/zoom-presence";

// Webhook should respond quickly
export const maxDuration = 60;

/**
 * Zoom Webhook Handler
 *
 * Receives event notifications from Zoom when meetings start/end or participants join/leave.
 * UPSERTS to Bronze layer (idempotent) and triggers Silver processing.
 *
 * Zoom Webhook Events:
 * https://developers.zoom.us/docs/api/rest/webhook-reference/
 *
 * Key events:
 * - meeting.started
 * - meeting.ended
 * - meeting.participant_joined
 * - meeting.participant_left
 */
/**
 * Zoom's HMAC-SHA256 signature over `v0:{timestamp}:{body}`. Required: participant events write
 * to the database and drive check-out DMs, so an unsigned request is refused, not waved through.
 */
function hasValidSignature(body: string, signature: string | null, timestamp: string | null): boolean {
  const secretToken = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  if (!secretToken || !signature || !timestamp) return false;
  const expected = `v0=${createHmac("sha256", secretToken).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("x-zm-signature");
    const timestamp = request.headers.get("x-zm-request-timestamp");

    if (!hasValidSignature(body, signature, timestamp)) {
      console.error("Missing or invalid Zoom webhook signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload = JSON.parse(body);
    console.log("Zoom webhook received: %s", payload.event, { timestamp });

    const eventType = payload.event;

    // Handle endpoint verification challenge (first-time setup)
    if (eventType === "endpoint.url_validation") {
      console.log("Zoom endpoint validation request");
      return NextResponse.json({
        plainToken: payload.payload.plainToken,
        encryptedToken: createHmac(
          "sha256",
          process.env.ZOOM_WEBHOOK_SECRET_TOKEN || ""
        )
          .update(payload.payload.plainToken)
          .digest("hex"),
      });
    }

    // Process meeting events
    if (eventType.startsWith("meeting.")) {
      await processMeetingEvent(payload);
    }

    // Return 200 OK immediately (webhook expects fast response)
    return NextResponse.json({
      received: true,
      event: eventType,
      processed: eventType.startsWith("meeting."),
    });
  } catch (error: any) {
    console.error("Error processing Zoom webhook:", error);

    // Still return 200 to avoid webhook retries on our internal errors
    // Log the error for debugging but don't fail the webhook
    return NextResponse.json({
      received: true,
      error: error.message,
    });
  }
}

/**
 * Process Zoom meeting events
 */
async function processMeetingEvent(payload: any) {
  const eventType = payload.event;
  const meetingData = payload.payload.object;

  // eventType is attacker-controlled (from the webhook payload). Pass it as a
  // %s substitution rather than interpolating it into the format string itself --
  // otherwise a value like "%s" or "%d" in eventType would make console.log
  // (which uses util.format under the hood) try to consume the trailing object
  // argument as a format substitution instead of printing it. See CodeQL
  // js/tainted-format-string.
  console.log("Processing Zoom event: %s", eventType, {
    meetingId: meetingData.id,
    uuid: meetingData.uuid,
    topic: meetingData.topic,
  });

  // Live presence: who joined or left, and when. Zoom's Report API (the import below) only covers
  // ended meetings, so this is the only record of who's in the room while a meeting runs. The
  // prickle check-out cron reads it; the import after the meeting ends is the backstop.
  const participantEvent = parseParticipantEvent(payload);
  if (participantEvent) {
    const { error } = await createServiceRoleClient()
      .schema("bronze")
      .from("zoom_participant_events")
      .upsert(participantEvent, {
        onConflict: "meeting_uuid,participant_key,event,event_time",
        ignoreDuplicates: true,
      });
    if (error) console.error("Error recording Zoom participant event:", error);
  }

  if (
    eventType === "meeting.ended" ||
    eventType === "meeting.participant_left"
  ) {
    // Meeting has ended or participant left - trigger attendance import
    // We need to wait a bit for Zoom to finalize the data
    // Trigger async import (fire-and-forget)

    const startTime = new Date(meetingData.start_time);
    const endTime = new Date(meetingData.end_time || Date.now());

    // Format dates for API (YYYY-MM-DD)
    const fromDate = startTime.toISOString().split("T")[0];
    const toDate = endTime.toISOString().split("T")[0];

    // Trigger Zoom import after a short delay to let Zoom finalize meeting data.
    // Wrapped in after() so Vercel keeps the function instance alive until the
    // delayed import completes, instead of tearing it down once the response
    // is sent (see docs/TODO.md Bug Fixes for the 2-month Slack webhook data-loss
    // incident this pattern is meant to avoid).
    after(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      // Prickle check-out DMs follow from this import: the 5-minute check-in cron
      // (app/api/internal/prickle-checkins) sends them once a prickle's attendance exists.
      try {
        await triggerZoomImport({ fromDate, toDate });
        console.log("Zoom import triggered successfully");
      } catch (error) {
        console.error("Error triggering Zoom import:", error);
      }
    });
  }
}

/**
 * Handle webhook verification (GET request)
 */
export async function GET(request: NextRequest) {
  // TODO: Implement proper webhook verification
  // For now, return 200 OK to confirm endpoint is accessible

  console.log("Zoom webhook verification request");

  return NextResponse.json({
    message: "Zoom webhook endpoint ready",
    verified: true,
  });
}
