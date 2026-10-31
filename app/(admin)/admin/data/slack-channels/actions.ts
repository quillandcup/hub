"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin-auth";
import { createRepos } from "@/lib/data/repos";
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

  const workspace = createRepos(supabase).slackWorkspace;
  const channel = await workspace.channelById(channelId).catch(() => null);
  if (!channel) return { error: "Channel not found" };
  // Public channels are open to every member; group DMs are always restricted.
  if (!channel.is_private || channel.is_mpim) return { error: "Only private channels can be restricted" };

  try {
    await workspace.restrictChannel(channelId, channel.name); // already restricted is fine
  } catch (error) {
    return { error: (error as Error).message };
  }
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

  try {
    await createRepos(supabase).slackWorkspace.unrestrictChannel(channelId);
  } catch (error) {
    return { error: (error as Error).message };
  }

  const { processed } = await triggerReprocessing("restricted_slack_channels", "local");
  const failed = processed.find((p) => !p.success);
  if (failed) console.error("Slack activity rebuild after lifting a channel restriction failed:", failed);

  revalidatePath(PAGE_PATH);
  return { success: true };
}
