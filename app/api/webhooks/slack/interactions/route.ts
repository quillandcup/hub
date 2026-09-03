import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { WebClient } from "@slack/web-api";
import { verifySlackSignature } from "@/lib/slack-signature";
import { resolveMemberIdForSlackUser } from "@/lib/writing-nudges";
import { MEASURE_LABELS, type WritingMeasure } from "@/lib/writing-projects";

// Webhook should respond quickly
export const maxDuration = 60;

/**
 * Slack Interactivity webhook -- handles block_actions payloads (currently just the
 * post-prickle quick-log dropdown, item 10). Separate from app/api/webhooks/slack/route.ts
 * (the Events API handler) because interactivity payloads are application/x-www-form-urlencoded
 * with a `payload` JSON field, not the plain JSON body the Events API sends -- can't share a
 * parser, so this is its own endpoint per the roadmap spec's own note. Requires
 * settings.interactivity.request_url = this route in slack-app-manifest.yml (manual step, see
 * Phase 1 plan -- the live Slack app's settings need updating to match).
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
  if (action?.action_id !== "writing_quick_log") return NextResponse.json({ received: true });

  try {
    await handleWritingQuickLog(payload, action);
  } catch (error) {
    console.error("Error handling writing_quick_log interaction:", error);
  }

  return NextResponse.json({ received: true });
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

  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

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
      await slack.chat.update({
        channel: channelId,
        ts: messageTs,
        text: `✅ Logged ${amount} ${measureLabel.toLowerCase()} — nice work!`,
      });
    }
  }
}
