import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse, after } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { triggerZoomImport } from "@/lib/processing/trigger";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createRepos } from "@/lib/data/repos";
import { parseParticipantEvent } from "@/lib/zoom-presence";
import { parseChatMessage } from "@/lib/zoom-chat";
import { PRIMARY_ZOOM_ACCOUNT_ID, PRIMARY_ZOOM_ACCOUNT_SLUG, zoomWebhookSecret } from "@/lib/zoom-accounts";
import type { ZoomAccount } from "@/lib/data/zoom";

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
 * - meeting.chat_message_sent
 */
/**
 * Zoom's HMAC-SHA256 signature over `v0:{timestamp}:{body}`. Required: participant events write
 * to the database and drive check-out DMs, so an unsigned request is refused, not waved through.
 */
function signatureMatches(secretToken: string, body: string, signature: string, timestamp: string): boolean {
  const expected = `v0=${createHmac("sha256", secretToken).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The accounts a webhook can come from. Each Zoom app has its own secret token. Without the database, only the primary account. */
async function webhookAccounts(): Promise<ZoomAccount[]> {
  try {
    return await createRepos(createServiceRoleClient()).zoom.accounts();
  } catch (error) {
    console.error("Could not load the Zoom accounts; accepting the primary account only:", error);
    return [{ id: PRIMARY_ZOOM_ACCOUNT_ID, slug: PRIMARY_ZOOM_ACCOUNT_SLUG, label: "Primary account", hostEmail: null, defaultPolicy: "keep", credentialsPrefix: "ZOOM" }];
  }
}

/**
 * The account whose secret token signed the request, with that secret, or null when none did (or the request is unsigned).
 * Every configured account's secret is tried; an account with no secret set never matches.
 */
async function signingAccount(body: string, signature: string | null, timestamp: string | null): Promise<{ account: ZoomAccount; secret: string } | null> {
  if (!signature || !timestamp) return null;
  for (const account of await webhookAccounts()) {
    const secret = zoomWebhookSecret(account.credentialsPrefix);
    if (secret && signatureMatches(secret, body, signature, timestamp)) return { account, secret };
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("x-zm-signature");
    const timestamp = request.headers.get("x-zm-request-timestamp");

    const signer = await signingAccount(body, signature, timestamp);
    if (!signer) {
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
        encryptedToken: createHmac("sha256", signer.secret)
          .update(payload.payload.plainToken)
          .digest("hex"),
      });
    }

    // Process meeting events
    if (eventType.startsWith("meeting.")) {
      await processMeetingEvent(payload, signer.account);
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
async function processMeetingEvent(payload: any, account: ZoomAccount) {
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
    try {
      await createRepos(createServiceRoleClient()).zoom.recordParticipantEvent({ ...participantEvent, zoom_account: account.id });
    } catch (error) {
      console.error("Error recording Zoom participant event:", error);
    }
  }

  // In-meeting chat. The webhook is the only source for a meeting that wasn't recorded to the cloud (Zoom's
  // pull path is the recording's CHAT file), so a failure here is logged for Vercel and not retried.
  const chatMessage = parseChatMessage(payload);
  if (chatMessage) {
    try {
      await createRepos(createServiceRoleClient()).zoom.recordChatMessage({ ...chatMessage, zoom_account: account.id });
    } catch (error) {
      console.error("Error recording Zoom chat message:", error);
    }
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
        await triggerZoomImport({ fromDate, toDate, account: account.slug });
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
