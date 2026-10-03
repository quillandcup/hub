import { NextRequest, NextResponse } from "next/server";
import { WebClient } from "@slack/web-api";
import { verifySlackSignature } from "@/lib/slack-signature";
import {
  parseCheckinAnswer,
  QUICK_LOG_ACTION_ID,
  replaceAnsweredBlock,
  resolveMemberIdForSlackUser,
  saveCheckinAnswer,
  withSavedAnswer,
  type CheckinAnswer,
} from "@/lib/prickle-checkin-dms";
import { MEASURE_LABELS, type WritingMeasure } from "@/lib/writing-projects";
import {
  sendSlackSignInMessage,
  SLACK_SEND_LINK_ACTION_ID,
} from "@/lib/slack-sign-in";
import { createServiceRoleClient } from "@/lib/supabase/service";

// Webhook should respond quickly
export const maxDuration = 60;

/**
 * Slack Interactivity webhook -- handles block_actions payloads: answers to the prickle check-in
 * and check-out DMs (check-in questions and the progress quick-log; lib/prickle-checkin-dms.ts)
 * and the Slack sign-in button ("Send me a link I can copy"; lib/slack-sign-in.ts). Separate
 * from app/api/webhooks/slack/route.ts (the Events API handler) because interactivity payloads
 * are application/x-www-form-urlencoded with a `payload` JSON field, not the plain JSON body the
 * Events API sends -- can't share a parser, so this is its own endpoint per the roadmap spec's
 * own note. Requires
 * settings.interactivity.request_url = this route in slack-app-manifest.yml (CI pushes the
 * manifest to the live Slack app after each production deploy; see docs/SLACK_MANIFEST.md).
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

  // Slack sign-in button (lib/slack-sign-in.ts): "Send me a link I can copy" DMs a copyable
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

  const checkinAnswer = parseCheckinAnswer(action);
  if (checkinAnswer) {
    try {
      await handleCheckinAnswer(payload, checkinAnswer);
    } catch (error) {
      console.error("Error handling prickle check-in answer:", error);
    }
    return NextResponse.json({ received: true });
  }

  if (action?.action_id !== QUICK_LOG_ACTION_ID) return NextResponse.json({ received: true });

  try {
    await handleWritingQuickLog(payload, action);
  } catch (error) {
    console.error("Error handling writing_quick_log interaction:", error);
  }

  return NextResponse.json({ received: true });
}

/**
 * A check-in question answered in a check-in or check-out DM: save it to the member's check-in,
 * then write the pick back into the message so a later update (another answer, a quick-log
 * confirmation) doesn't reset it on screen.
 */
async function handleCheckinAnswer(payload: any, answer: CheckinAnswer) {
  const slackUserId = payload.user?.id as string | undefined;
  if (!slackUserId) return;

  const supabase = createServiceRoleClient();
  const memberId = await resolveMemberIdForSlackUser(supabase, slackUserId);
  if (!memberId) {
    console.error("prickle_checkin_answer: no member matched for Slack user", slackUserId);
    return;
  }

  const error = await saveCheckinAnswer(supabase, memberId, answer);
  if (error) {
    console.error("prickle_checkin_answer: not saved", { memberId, prickleId: answer.prickleId, field: answer.field, error });
    return;
  }

  const channelId = payload.channel?.id as string | undefined;
  const messageTs = payload.message?.ts as string | undefined;
  const blocks = withSavedAnswer(payload.message?.blocks, answer);
  const token = process.env.SLACK_BOT_TOKEN;
  if (channelId && messageTs && blocks && token) {
    await new WebClient(token).chat.update({ channel: channelId, ts: messageTs, text: payload.message?.text ?? "", blocks });
  }
}

async function handleWritingQuickLog(payload: any, action: any) {
  const [projectId, prickleId, measure, amountStr] = String(action.selected_option?.value ?? "").split(":");
  const amount = Number(amountStr);
  const slackUserId = payload.user?.id as string | undefined;
  const channelId = payload.channel?.id as string | undefined;
  const messageTs = payload.message?.ts as string | undefined;

  if (!projectId || !prickleId || !measure || Number.isNaN(amount) || !slackUserId) {
    console.error("writing_quick_log: malformed action value or missing user", action.selected_option?.value);
    return;
  }

  const supabase = createServiceRoleClient();

  const memberId = await resolveMemberIdForSlackUser(supabase, slackUserId);
  if (!memberId) {
    console.error("writing_quick_log: no member matched for Slack user", slackUserId);
    return;
  }

  // Never trust the project id embedded in the action value alone -- verify it's still this
  // member's project before writing anything (same principle as assertOwnsProject in
  // app/(member)/projects/actions.ts).
  const { data: project } = await supabase
    .from("writing_projects")
    .select("id")
    .eq("id", projectId)
    .eq("member_id", memberId)
    .single();
  if (!project) {
    console.error("writing_quick_log: project not found or not owned by matched member", { projectId, memberId });
    return;
  }

  const { data: entry, error: insertError } = await supabase
    .from("writing_progress_entries")
    .insert({
      project_id: projectId,
      member_id: memberId,
      prickle_id: prickleId,
      entry_date: new Date().toISOString().slice(0, 10),
      measure,
      mode: "delta",
      amount,
    })
    .select("id")
    .single();

  if (insertError || !entry) {
    console.error("writing_quick_log: failed to insert progress entry", insertError);
    return;
  }

  // Phase 1, item 11: same engagement signal as a manual log (see
  // app/(member)/projects/actions.ts logProgress) -- this is just a different entry point into
  // the same writing_progress_entries table.
  const { error: activityError } = await supabase.from("member_activities").insert({
    member_id: memberId,
    activity_type: "writing_progress_logged",
    activity_category: "writing",
    title: "Logged writing progress",
    related_id: entry.id,
    engagement_value: 5,
    occurred_at: new Date().toISOString(),
    source: "writing_progress",
  });
  if (activityError) console.error("writing_quick_log: failed to insert member_activities row", activityError);

  if (channelId && messageTs) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (token) {
      const slack = new WebClient(token);
      const measureLabel = MEASURE_LABELS[measure as WritingMeasure] ?? measure;
      const confirmation = `✅ Logged ${amount} ${measureLabel.toLowerCase()} — nice work!`;
      await slack.chat.update({
        channel: channelId,
        ts: messageTs,
        text: confirmation,
        blocks: replaceAnsweredBlock(payload.message?.blocks, action.block_id, confirmation),
      });
    }
  }
}
