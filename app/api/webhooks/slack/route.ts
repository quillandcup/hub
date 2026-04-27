import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

// Webhook should respond quickly
export const maxDuration = 60;

/**
 * Slack Events API Webhook Handler
 *
 * Receives event notifications from Slack when messages are posted or reactions added.
 * UPSERTS to Bronze layer (idempotent) and triggers Silver processing.
 *
 * Slack Events API:
 * https://api.slack.com/apis/connections/events-api
 *
 * Key events:
 * - message (new message posted)
 * - reaction_added (emoji reaction added to message)
 * - reaction_removed (emoji reaction removed from message)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const payload = JSON.parse(body);

    // Verify webhook signature
    // Slack uses HMAC-SHA256 signature verification
    const signature = request.headers.get("x-slack-signature");
    const timestamp = request.headers.get("x-slack-request-timestamp");

    console.log("Slack webhook received:", {
      type: payload.type,
      event: payload.event?.type,
      signature: signature ? "present" : "missing",
      timestamp,
    });

    // Verify signature if signing secret is configured
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (signingSecret && signature && timestamp) {
      // Verify request is not too old (prevent replay attacks)
      const requestTimestamp = parseInt(timestamp);
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - requestTimestamp) > 60 * 5) {
        console.error("Slack webhook timestamp too old");
        return NextResponse.json({ error: "Request too old" }, { status: 401 });
      }

      const sigBasestring = `v0:${timestamp}:${body}`;
      const mySignature = 'v0=' + createHmac('sha256', signingSecret)
        .update(sigBasestring)
        .digest('hex');

      if (signature !== mySignature) {
        console.error("Invalid Slack webhook signature");
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    // Handle URL verification challenge (first-time setup)
    if (payload.type === "url_verification") {
      console.log("Slack URL verification request");
      return NextResponse.json({
        challenge: payload.challenge,
      });
    }

    // Handle event callbacks
    if (payload.type === "event_callback") {
      await processSlackEvent(payload.event);
    }

    // Return 200 OK immediately (webhook expects fast response)
    return NextResponse.json({
      received: true,
      type: payload.type,
      event: payload.event?.type,
    });
  } catch (error: any) {
    console.error("Error processing Slack webhook:", error);

    // Still return 200 to avoid webhook retries on our internal errors
    // Log the error for debugging but don't fail the webhook
    return NextResponse.json({
      received: true,
      error: error.message,
    });
  }
}

/**
 * Process Slack event and UPSERT to Bronze layer
 */
async function processSlackEvent(event: any) {
  // Use service role client for webhooks (no user session)
  const { createClient: createSupabaseClient } = await import('@supabase/supabase-js');
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const eventType = event.type;

  console.log(`Processing Slack event: ${eventType}`, {
    channel: event.channel,
    user: event.user,
    ts: event.ts,
  });

  try {
    if (eventType === "message") {
      // UPSERT message to Bronze layer
      await supabase.schema("bronze").from("slack_messages").upsert(
        {
          channel_id: event.channel,
          message_ts: event.ts,
          user_id: event.user,
          text: event.text,
          thread_ts: event.thread_ts || null,
          occurred_at: new Date(parseFloat(event.ts) * 1000).toISOString(),
          raw_data: event,
        },
        {
          onConflict: "channel_id,message_ts",
        }
      );

      console.log("Slack message upserted:", event.ts);

      // Trigger Silver processing asynchronously
      triggerSlackProcessing(event.ts);
    } else if (eventType === "reaction_added") {
      // UPSERT reaction to Bronze layer
      await supabase.schema("bronze").from("slack_reactions").upsert(
        {
          channel_id: event.item.channel,
          message_ts: event.item.ts,
          user_id: event.user,
          reaction: event.reaction,
          occurred_at: new Date(parseFloat(event.event_ts) * 1000).toISOString(),
          raw_data: event,
        },
        {
          // Note: Supabase doesn't support composite unique constraints in upsert
          // We'll rely on the unique constraint to prevent duplicates
          onConflict: "channel_id,message_ts,user_id,reaction",
        }
      );

      console.log("Slack reaction upserted:", event.reaction);

      // Trigger Silver processing asynchronously
      triggerSlackProcessing(event.item.ts);
    } else if (eventType === "reaction_removed") {
      // DELETE reaction from Bronze layer
      await supabase
        .schema("bronze")
        .from("slack_reactions")
        .delete()
        .eq("channel_id", event.item.channel)
        .eq("message_ts", event.item.ts)
        .eq("user_id", event.user)
        .eq("reaction", event.reaction);

      console.log("Slack reaction removed:", event.reaction);

      // Trigger Silver processing asynchronously
      triggerSlackProcessing(event.item.ts);
    }
  } catch (error: any) {
    console.error("Error processing Slack event:", error);
    // Don't throw - we already returned 200 OK to Slack
  }
}

/**
 * Trigger Silver layer processing for Slack data
 */
function triggerSlackProcessing(messageTs: string) {
  // Convert Slack timestamp to date
  const timestamp = new Date(parseFloat(messageTs) * 1000);
  const fromDate = new Date(timestamp);
  fromDate.setDate(fromDate.getDate() - 1); // Process 1 day before/after
  const toDate = new Date(timestamp);
  toDate.setDate(toDate.getDate() + 1);

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  // Trigger async processing (fire-and-forget)
  fetch(`${baseUrl}/api/process/slack`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Use service role key to bypass auth (internal processing)
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      fromDate: fromDate.toISOString(),
      toDate: toDate.toISOString(),
    }),
  })
    .then((response) => {
      if (!response.ok) {
        console.error("Failed to trigger Slack processing:", response.statusText);
      } else {
        console.log("Slack processing triggered successfully");
      }
    })
    .catch((error) => {
      console.error("Error triggering Slack processing:", error);
    });
}

/**
 * Handle webhook verification (GET request)
 */
export async function GET(request: NextRequest) {
  // TODO: Implement proper webhook verification
  // For now, return 200 OK to confirm endpoint is accessible

  console.log("Slack webhook verification request");

  return NextResponse.json({
    message: "Slack webhook endpoint ready",
    verified: true,
  });
}
