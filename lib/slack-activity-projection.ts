import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Bring one Slack message's member_activities (the message and its reactions) in step with Bronze, for the
 * Slack webhook: a constant-cost call per event, instead of rebuilding a whole day of activities that
 * concurrent events then queue behind (supabase/migrations/20270227000000_slack_activity_per_message.sql).
 * The windowed rebuild (/api/process/slack) is still how imports, restriction changes and the nightly run
 * reconcile everything, including a Slack user this doesn't know yet. Returns the counts, or null if it failed
 * (logged: the next rebuild fixes it, so a failure here never fails the webhook).
 */
export async function projectSlackActivity(
  supabase: SupabaseClient,
  channelId: string,
  messageTs: string
): Promise<{ messages: number; reactions: number } | null> {
  const { data, error } = await supabase.rpc("slack_activity_project_message", { p_channel_id: channelId, p_message_ts: messageTs });
  if (error) {
    console.error("Projecting a Slack message's activities failed:", error);
    return null;
  }
  const counts = data as { messages?: number; reactions?: number } | null;
  return { messages: counts?.messages ?? 0, reactions: counts?.reactions ?? 0 };
}
