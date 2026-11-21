import { NextRequest, NextResponse } from "next/server";
import { createSlackClient } from "@/lib/slack-client";
import { verifySlackSignature } from "@/lib/slack-signature";
import { handleDmInteraction, isDmActionId } from "@/lib/prickle-dm-interactions";
import { resolveMemberIdForSlackUser } from "@/lib/slack-member-ids";
import {
  sendSlackSignInMessage,
  SLACK_SEND_LINK_ACTION_ID,
} from "@/lib/slack-sign-in";
import { createRepos } from "@/lib/data/repos";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getSlackBotToken } from "@/lib/slack-bot-token";

// Webhook should respond quickly
export const maxDuration = 60;

/**
 * Slack Interactivity webhook -- handles block_actions payloads: answers to the prickle check-in
 * and check-out DMs (check-in questions, the star rating buttons and the progress number inputs;
 * src/lib/prickle-checkin-dms.ts)
 * and the Slack sign-in button ("Send me a link I can copy"; src/lib/slack-sign-in.ts). Separate
 * from src/app/api/webhooks/slack/route.ts (the Events API handler) because interactivity payloads
 * are application/x-www-form-urlencoded with a `payload` JSON field, not the plain JSON body the
 * Events API sends -- can't share a parser, so this is its own endpoint per the roadmap spec's
 * own note. Requires
 * settings.interactivity.request_url = this route in config/slack-app-manifest.yml (CI pushes the
 * manifest to the live Slack app after each production deploy; see docs/infrastructure/SLACK_MANIFEST.md).
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const signature = request.headers.get("x-slack-signature");
  const timestamp = request.headers.get("x-slack-request-timestamp");
  const sigResult = verifySlackSignature(rawBody, signature, timestamp, process.env.SLACK_SIGNING_SECRET);
  if (!sigResult.valid) {
    console.error("Invalid or missing Slack interactivity signature:", sigResult.reason);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payloadJson = new URLSearchParams(rawBody).get("payload");
  if (!payloadJson) return NextResponse.json({ received: true });

  let payload: any;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return NextResponse.json({ received: true });
  }

  // Return 200 immediately for anything we don't handle -- Slack retries on non-2xx.
  if (payload.type !== "block_actions") return NextResponse.json({ received: true });

  const action = payload.actions?.[0];

  // Slack sign-in button (src/lib/slack-sign-in.ts): "Send me a link I can copy" DMs a copyable
  // one-time link.
  const signInActions: Record<string, typeof sendSlackSignInMessage> = {
    [SLACK_SEND_LINK_ACTION_ID]: sendSlackSignInMessage,
  };
  const signInAction = action?.action_id ? signInActions[action.action_id] : undefined;
  if (signInAction && typeof payload.user?.id === "string") {
    try {
      await signInAction(createServiceRoleClient(), payload.user.id, new URL(request.url).origin);
    } catch (error) {
      console.error("Error handling Slack sign-in action %s:", action.action_id, error);
    }
    return NextResponse.json({ received: true });
  }

  // Check-in and check-out DM controls and the writing quick-log (src/lib/prickle-dm-interactions.ts, shared with the Hub chat).
  if (!isDmActionId(action?.action_id)) return NextResponse.json({ received: true });
  try {
    await handleDmPress(payload, action);
  } catch (error) {
    console.error("Error handling Slack DM action %s:", action.action_id, error);
  }
  return NextResponse.json({ received: true });
}

/** A press in one of our DMs, as the Slack user who pressed it: their member, then the same handlers the Hub chat uses. */
async function handleDmPress(payload: any, action: any) {
  const slackUserId = payload.user?.id as string | undefined;
  if (!slackUserId) return;
  const repos = createRepos(createServiceRoleClient());
  const memberId = await resolveMemberIdForSlackUser(repos, slackUserId);
  if (!memberId) {
    console.error("%s: no member matched for Slack user", action.action_id, slackUserId);
    return;
  }
  const channelId = payload.channel?.id as string | undefined;
  const messageTs = payload.message?.ts as string | undefined;
  await handleDmInteraction({
    repos,
    memberId,
    action,
    blocks: payload.message?.blocks,
    text: payload.message?.text ?? "",
    update: async (message) => {
      const token = await getSlackBotToken();
      if (channelId && messageTs && token) await createSlackClient(token).chat.update({ channel: channelId, ts: messageTs, ...message });
    },
  });
}
