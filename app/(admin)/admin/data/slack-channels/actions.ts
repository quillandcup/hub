"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin-auth";
import { triggerReprocessing } from "@/lib/processing/trigger";

const PAGE_PATH = "/admin/data/slack-channels";

/**
 * Stop staff reading a channel's messages. Written with the admin's own client
 * so the audit log records who did it; a trigger on the table clears the text
 * already copied into member activities (docs/SLACK_BRIDGED_CHAT.md).
 */
export async function restrictSlackChannel(channelId: string) {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  const { supabase } = auth;

  const { data: channel } = await supabase
    .schema("bronze")
    .from("slack_channels")
    .select("name, is_private, is_mpim")
    .eq("channel_id", channelId)
    .maybeSingle();
  if (!channel) return { error: "Channel not found" };
  // Public channels are open to every member; group DMs are always restricted.
  if (!channel.is_private || channel.is_mpim) return { error: "Only private channels can be restricted" };

  const { error } = await supabase
    .from("restricted_slack_channels")
    .insert({ channel_id: channelId, name: channel.name });

  if (error && error.code !== "23505") return { error: error.message }; // already restricted
  revalidatePath(PAGE_PATH);
  return { success: true };
}

/**
 * Let staff read a channel's messages again. The Slack activity rebuild puts
 * message text back for the last 90 days; older activity rows stay without it.
 */
export async function unrestrictSlackChannel(channelId: string) {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  const { supabase } = auth;

  const { error } = await supabase.from("restricted_slack_channels").delete().eq("channel_id", channelId);
  if (error) return { error: error.message };

  const { processed } = await triggerReprocessing("restricted_slack_channels", "local");
  const failed = processed.find((p) => !p.success);
  if (failed) console.error("Slack activity rebuild after lifting a channel restriction failed:", failed);

  revalidatePath(PAGE_PATH);
  return { success: true };
}
