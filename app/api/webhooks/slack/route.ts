import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { CONNECTION_CONFIRMATION_MESSAGE_THRESHOLD } from "@/lib/wheel-of-wonder";

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
      const { error } = await supabase.schema("bronze").from("slack_messages").upsert(
        {
          channel_id: event.channel,
          message_ts: event.ts,
          user_id: event.user,
          text: event.text,
          thread_ts: event.thread_ts || null,
          occurred_at: new Date(parseFloat(event.ts) * 1000).toISOString(),
          raw_payload: event,
        },
        {
          onConflict: "channel_id,message_ts",
        }
      );

      if (error) {
        console.error("Error upserting Slack message:", error);
        return;
      }

      console.log("Slack message upserted:", event.ts);

      // Wheel of Wonder: track messages toward a "confirmed connection"
      // (never counting the bot's own message — Slack message events carry
      // a bot_id when the sender is a bot/app). See
      // app/(member)/wheel-of-wonder/actions.ts.
      if (!event.bot_id) {
        await trackWheelExchange(supabase, event);
      }

      // Trigger Silver processing asynchronously
      triggerSlackProcessing(event.ts);
    } else if (eventType === "reaction_added") {
      // UPSERT reaction to Bronze layer
      const { error } = await supabase.schema("bronze").from("slack_reactions").upsert(
        {
          channel_id: event.item.channel,
          message_ts: event.item.ts,
          user_id: event.user,
          reaction: event.reaction,
          occurred_at: new Date(parseFloat(event.event_ts) * 1000).toISOString(),
          raw_payload: event,
        },
        {
          // Note: Supabase doesn't support composite unique constraints in upsert
          // We'll rely on the unique constraint to prevent duplicates
          onConflict: "channel_id,message_ts,user_id,reaction",
        }
      );

      if (error) {
        console.error("Error upserting Slack reaction:", error);
        return;
      }

      console.log("Slack reaction upserted:", event.reaction);

      // Trigger Silver processing asynchronously
      triggerSlackProcessing(event.item.ts);
    } else if (eventType === "reaction_removed") {
      // DELETE reaction from Bronze layer
      const { error } = await supabase
        .schema("bronze")
        .from("slack_reactions")
        .delete()
        .eq("channel_id", event.item.channel)
        .eq("message_ts", event.item.ts)
        .eq("user_id", event.user)
        .eq("reaction", event.reaction);

      if (error) {
        console.error("Error removing Slack reaction:", error);
        return;
      }

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
 * Wheel of Wonder: if this message landed in a room we opened for a
 * proposed match (see app/(member)/wheel-of-wonder/actions.ts), attribute
 * it to whichever participant sent it -- matched directly against the
 * Slack user IDs captured at room-creation time, not via
 * member_name_aliases, so attribution never depends on that resolving
 * cleanly. Promotes the match to "confirmed" once both people have sent at
 * least one message and their combined count reaches
 * CONNECTION_CONFIRMATION_MESSAGE_THRESHOLD -- a single unanswered reply
 * shouldn't count as a real connection.
 */
async function trackWheelExchange(supabase: any, event: any) {
  try {
    const { data: match, error: matchError } = await supabase
      .from("wheel_of_wonder_matches")
      .select(
        "id, spinner_member_id, matched_member_id, spinner_slack_user_id, matched_slack_user_id, spinner_message_count, matched_message_count"
      )
      .eq("slack_channel_id", event.channel)
      .eq("status", "proposed")
      .maybeSingle();

    if (matchError) {
      console.error("Error looking up Wheel of Wonder match for channel:", matchError);
      return;
    }
    if (!match) return;

    const isSpinner = event.user && event.user === match.spinner_slack_user_id;
    const isMatched = event.user && event.user === match.matched_slack_user_id;
    if (!isSpinner && !isMatched) return; // shouldn't happen -- only 3 people are ever in this room

    const spinnerMessageCount = match.spinner_message_count + (isSpinner ? 1 : 0);
    const matchedMessageCount = match.matched_message_count + (isMatched ? 1 : 0);
    const bothSidesParticipated = spinnerMessageCount > 0 && matchedMessageCount > 0;
    const shouldConfirm =
      bothSidesParticipated &&
      spinnerMessageCount + matchedMessageCount >= CONNECTION_CONFIRMATION_MESSAGE_THRESHOLD;

    const update: Record<string, unknown> = {
      spinner_message_count: spinnerMessageCount,
      matched_message_count: matchedMessageCount,
    };
    if (shouldConfirm) {
      update.status = "confirmed";
      update.confirmed_at = new Date().toISOString();
      update.confirmed_by_member_id = isSpinner ? match.spinner_member_id : match.matched_member_id;
    }

    const { error: updateError } = await supabase.from("wheel_of_wonder_matches").update(update).eq("id", match.id);

    if (updateError) {
      console.error("Error updating Wheel of Wonder match exchange:", updateError);
      return;
    }

    if (shouldConfirm) console.log("Wheel of Wonder match confirmed:", match.id);
  } catch (error) {
    console.error("Error tracking Wheel of Wonder exchange:", error);
  }
}

/**
 * Trigger Silver layer processing for Slack data
 */
function triggerSlackProcessing(messageTs: string) {
  const timestamp = new Date(parseFloat(messageTs) * 1000);
  const from = new Date(timestamp);
  from.setDate(from.getDate() - 1);
  const to = new Date(timestamp);
  to.setDate(to.getDate() + 1);

  // Call the process/slack handler directly — avoids VERCEL_URL routing through
  // Vercel deployment protection which blocks unauthenticated *.vercel.app requests.
  triggerReprocessing("slack_messages", "bronze", { dateRange: { from, to } })
    .then(() => console.log("Slack processing triggered successfully"))
    .catch((error) => console.error("Error triggering Slack processing:", error));
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
