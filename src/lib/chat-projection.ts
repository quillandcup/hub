import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Bring one Slack message into the chat mirror right now: the webhook's path, for new
 * messages, edits, deletes and reaction changes. Constant cost per event (see
 * project_slack_chat_message in 20261010000000_chat_mirror.sql); the windowed
 * /api/process/chat run is for imports and never runs per webhook event.
 *
 * Returns whether the message was in the chat to project into. Failures are logged, not thrown: Bronze already has the message and the nightly import
 * projects anything this missed. `supabase` must be a service-role client.
 */
export async function projectChatMessage(supabase: SupabaseClient, channelId: string, messageTs: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("project_slack_chat_message", {
    p_channel_id: channelId,
    p_message_ts: messageTs,
  });
  if (error) {
    console.error("Error projecting Slack message into chat:", error);
    return false;
  }
  // False means the chat doesn't know the message (nor does Bronze), so nothing could be attached to it.
  return Boolean((data as { projected?: boolean } | null)?.projected);
}
