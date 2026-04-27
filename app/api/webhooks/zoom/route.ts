import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

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
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const payload = JSON.parse(body);

    // Verify webhook signature
    // Zoom uses HMAC-SHA256 signature verification
    const signature = request.headers.get("x-zm-signature");
    const timestamp = request.headers.get("x-zm-request-timestamp");

    console.log("Zoom webhook received:", {
      event: payload.event,
      signature: signature ? "present" : "missing",
      timestamp,
    });

    // Verify signature if secret token is configured
    const secretToken = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
    if (secretToken && signature) {
      const message = `v0:${timestamp}:${body}`;
      const hashForVerify = createHmac('sha256', secretToken)
        .update(message)
        .digest('hex');
      const expectedSignature = `v0=${hashForVerify}`;

      if (signature !== expectedSignature) {
        console.error("Invalid Zoom webhook signature");
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

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

  console.log(`Processing Zoom event: ${eventType}`, {
    meetingId: meetingData.id,
    uuid: meetingData.uuid,
    topic: meetingData.topic,
  });

  // For meeting start/end events, we can store basic meeting metadata
  // For participant events, we would need to fetch full participant data from Zoom API
  // Since webhooks should be fast, we'll trigger a background sync instead

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

    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    // Trigger Zoom import asynchronously
    // Use a slight delay (10 seconds) to ensure Zoom has finalized the meeting data
    setTimeout(() => {
      fetch(`${baseUrl}/api/import/zoom`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Use service role key to bypass auth (internal processing)
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          fromDate,
          toDate,
        }),
      })
        .then((response) => {
          if (!response.ok) {
            console.error("Failed to trigger Zoom import:", response.statusText);
          } else {
            console.log("Zoom import triggered successfully");
          }
        })
        .catch((error) => {
          console.error("Error triggering Zoom import:", error);
        });
    }, 10000); // 10 second delay
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
