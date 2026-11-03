"use server";

import { createClient } from "@/lib/supabase/server";
import { dmCaller, postingCaller } from "@/lib/chat/caller";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";
import { openSlackDm, type OpenDmResult } from "@/lib/chat/slack-dms";
import { isId } from "@/lib/ids";
import { withAction } from "@/lib/analytics/server";

export type StartDmResult = { ok: true; channelId: string } | { ok: false; error: string };

/** What chat_find_or_create_dm's 'chat_dm: <reason>' errors mean to the person who asked. */
const DM_ERRORS: Record<string, string> = {
  no_member: "You need a member profile to send messages.",
  bad_member: "You can't message that person.",
};

const SLACK_DM_ERRORS: Record<Exclude<OpenDmResult, { ok: true }>["reason"], string> = {
  not_production: "Slack direct messages only work on the live Hub.",
  not_connected: "Reconnect Slack in Settings to message people.",
  unknown_person: "They haven't connected Slack to the Hub yet, so there's no Slack direct message to open.",
  slack_refused: "Slack wouldn't open that conversation. Try again in a moment.",
};

/**
 * The signed-in member opens their direct message with another member. With the Slack DM bridge on for
 * them it is their Slack DM, opened with their own token (find-or-create in Slack, so the history is the
 * same in both places). Otherwise, with Hub direct messages, it is a Hub-only conversation created the first
 * time (nothing is sent to Slack), private to the two of them. Either way the other person sees it in their chat.
 */
async function startDirectMessageImpl(memberId: string): Promise<StartDmResult> {
  if (!isId(memberId, "mbr")) return { ok: false, error: "Something went wrong." };
  const bridge = await slackBridgeCaller();
  const caller = bridge ?? (await dmCaller());
  if (!caller) return { ok: false, error: "Direct messages aren't available to you yet." };
  if (memberId === caller.identity.memberId) return { ok: false, error: DM_ERRORS.bad_member };

  if (bridge) {
    const opened = await openSlackDm(createServiceRoleClient(), bridge.identity.memberId, memberId);
    return opened.ok ? { ok: true, channelId: opened.channelId } : { ok: false, error: SLACK_DM_ERRORS[opened.reason] };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("chat_find_or_create_dm", { p_other_member_id: memberId });
  if (error || !data) {
    const reason = /chat_dm: (\w+)/.exec(error?.message ?? "")?.[1];
    if (!reason) console.error("chat_find_or_create_dm failed:", error?.message);
    return { ok: false, error: (reason && DM_ERRORS[reason]) || "Something went wrong. Try again." };
  }
  return { ok: true, channelId: data };
}

/** The caller when the Slack DM bridge is on for them (and they can post): their DMs are Slack's. */
async function slackBridgeCaller() {
  const caller = await postingCaller();
  if (!caller) return null;
  return (await effectiveMemberHasFeature("slack_dm_bridge", caller.identity, await getUserFeaturePreviews(caller.userId))) ? caller : null;
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function startDirectMessage(memberId: string): Promise<StartDmResult> {
  return withAction("chat_dm_started", () => startDirectMessageImpl(memberId));
}
