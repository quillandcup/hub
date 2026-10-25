import { createClient } from "@supabase/supabase-js";
import { loadDemoEnv } from "../env";

/**
 * The demo has no Slack. In production a chat post is saved first and then sent to Slack, and Slack's answer flips
 * the message from pending to sent (the page picks that up through Realtime). Outside production the app leaves the
 * post pending, so the recording plays Slack's part: it marks the post sent with a Slack timestamp, exactly the
 * state the real answer leaves, and the page shows what a member would see a second later.
 */
export async function acknowledgePost(body: string): Promise<void> {
  const env = loadDemoEnv();
  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: content, error } = await admin
    .from("chat_message_contents")
    .select("message_id")
    .eq("body", body)
    .order("message_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !content) throw new Error(`slack stand-in: no saved post with that text (${error?.message ?? "not found"})`);
  const { error: updateError } = await admin
    .from("chat_messages")
    .update({ slack_sync_status: "sent", slack_ts: `${Math.floor(Date.now() / 1000)}.900001` })
    .eq("id", content.message_id);
  if (updateError) throw new Error(`slack stand-in: ${updateError.message}`);
}

/** The id of a demo chat channel by name, for the cookie that makes /chat open on it the way it does for a returning member. */
export async function demoChannelId(name: string): Promise<string> {
  const env = loadDemoEnv();
  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.from("chat_channels").select("id").eq("name", name).like("slack_channel_id", "CDEMO%").maybeSingle();
  if (error || !data) throw new Error(`no demo chat channel named ${name} (run pnpm demo:seed)`);
  return data.id as string;
}

/** Remove what an earlier recording posted from the Hub (messages written in the app, not the seeded Slack-origin ones), so each starts the same. */
export async function forgetPosts(): Promise<void> {
  const env = loadDemoEnv();
  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: channels } = await admin.from("chat_channels").select("id").like("slack_channel_id", "CDEMO%");
  const ids = (channels ?? []).map((c) => c.id as string);
  if (ids.length === 0) return;
  const { error } = await admin.from("chat_messages").delete().in("channel_id", ids).eq("origin", "app");
  if (error) throw new Error(`slack stand-in: ${error.message}`);
}
