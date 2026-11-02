"use server";

import { createClient } from "@/lib/supabase/server";
import { dmCaller } from "@/lib/chat/caller";
import { isId } from "@/lib/ids";
import { withAction } from "@/lib/analytics/server";

export type StartDmResult = { ok: true; channelId: string } | { ok: false; error: string };

/** What chat_find_or_create_dm's 'chat_dm: <reason>' errors mean to the person who asked. */
const DM_ERRORS: Record<string, string> = {
  no_member: "You need a member profile to send messages.",
  bad_member: "You can't message that person.",
};

/**
 * The signed-in member opens their direct message with another member, creating it the first time.
 * The conversation is Hub-only (nothing is sent to Slack) and private to the two of them. The feature
 * decides who can start one; the other person sees it in their chat either way.
 */
async function startDirectMessageImpl(memberId: string): Promise<StartDmResult> {
  if (!isId(memberId, "mbr")) return { ok: false, error: "Something went wrong." };
  const caller = await dmCaller();
  if (!caller) return { ok: false, error: "Direct messages aren't available to you yet." };
  if (memberId === caller.identity.memberId) return { ok: false, error: DM_ERRORS.bad_member };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("chat_find_or_create_dm", { p_other_member_id: memberId });
  if (error || !data) {
    const reason = /chat_dm: (\w+)/.exec(error?.message ?? "")?.[1];
    if (!reason) console.error("chat_find_or_create_dm failed:", error?.message);
    return { ok: false, error: (reason && DM_ERRORS[reason]) || "Something went wrong. Try again." };
  }
  return { ok: true, channelId: data };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function startDirectMessage(memberId: string): Promise<StartDmResult> {
  return withAction("chat_dm_started", () => startDirectMessageImpl(memberId));
}
