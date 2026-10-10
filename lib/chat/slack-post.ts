import { WebClient } from "@slack/web-api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clock } from "@/lib/clock";
import { isSlackTestMode } from "@/lib/slack";

/**
 * The outbox's second step (docs/SLACK_BRIDGED_CHAT.md, "Hub -> Slack"): a message a member wrote
 * in the Hub is already in chat_messages as 'pending' (chat_post_message); this posts it to Slack
 * as the bot, under the member's name and photo, and stores the ts Slack returns. Service role.
 */

/** Hub text is plain; Slack's mrkdwn treats these three characters as syntax. */
export function escapeForSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Marks our own posts, so Slack's event for one is recognised as ours (chat_adopt_posted_message). */
export function hubMessageMetadata(messageId: string) {
  return { event_type: "hub_message", event_payload: { app_message_id: messageId } };
}

export type SendResult = "sent" | "skipped" | "failed";

interface OutboxRow {
  id: string;
  origin: string;
  slack_sync_status: string | null;
  deleted_at: string | null;
  author_member_id: string | null;
  thread_root_id: string | null;
  chat_message_contents: { body: string } | { body: string }[] | null;
  chat_channels: { slack_channel_id: string | null } | { slack_channel_id: string | null }[] | null;
}

const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * Posts one pending (or failed) app message to Slack. Skips anything already sent, not ours, or
 * deleted, and does nothing outside production unless Slack posting is explicitly on there
 * (SLACK_TEST_MODE, like every other Slack send): the message stays pending rather than reaching a real
 * channel from a dev or preview deploy.
 */
export async function sendChatMessageToSlack(supabase: SupabaseClient, messageId: string): Promise<SendResult> {
  const { data } = await supabase
    .from("chat_messages")
    .select(
      "id, origin, slack_sync_status, deleted_at, author_member_id, thread_root_id, chat_message_contents(body), chat_channels(slack_channel_id)"
    )
    .eq("id", messageId)
    .maybeSingle();
  const row = data as OutboxRow | null;
  if (!row || row.origin !== "app" || row.slack_sync_status === "sent" || row.deleted_at) return "skipped";

  if (isSlackTestMode()) {
    console.warn("sendChatMessageToSlack: SLACK_TEST_MODE is on, leaving message %s pending", messageId);
    return "skipped";
  }

  const fail = async (reason: string, error?: unknown): Promise<SendResult> => {
    console.error("sendChatMessageToSlack: %s (message %s)", reason, messageId, error ?? "");
    await supabase.rpc("chat_mark_message_failed", { p_message_id: messageId });
    return "failed";
  };

  const token = process.env.SLACK_BOT_TOKEN;
  const body = one(row.chat_message_contents)?.body;
  const slackChannelId = one(row.chat_channels)?.slack_channel_id;
  if (!token) return fail("SLACK_BOT_TOKEN not configured");
  if (!body || !slackChannelId || !row.author_member_id) return fail("message is missing its body, channel or author");

  let threadTs: string | undefined;
  if (row.thread_root_id) {
    const { data: root } = await supabase.from("chat_messages").select("slack_ts").eq("id", row.thread_root_id).maybeSingle();
    if (!root?.slack_ts) return fail("thread root has no Slack ts");
    threadTs = root.slack_ts;
  }

  const { data: author } = await supabase
    .from("member_directory")
    .select("name, display_name, photo_url")
    .eq("id", row.author_member_id)
    .maybeSingle();
  const photo = author?.photo_url && /^https:\/\//.test(author.photo_url) ? author.photo_url : undefined;

  try {
    const slack = new WebClient(token);
    const result = await slack.chat.postMessage({
      channel: slackChannelId,
      text: escapeForSlack(body),
      thread_ts: threadTs,
      username: author?.display_name || author?.name || undefined,
      icon_url: photo,
      unfurl_links: false,
      unfurl_media: false,
      metadata: hubMessageMetadata(messageId),
    });
    if (!result.ok || !result.ts) return fail("Slack did not return a ts");
    const { error } = await supabase.rpc("chat_mark_message_sent", { p_message_id: messageId, p_slack_ts: result.ts });
    if (error) {
      // Posted but not recorded: leave it pending (not failed) so Slack's own event can still link it.
      console.error("chat_mark_message_sent failed for %s:", messageId, error.message);
    }
    return "sent";
  } catch (error) {
    return fail("chat.postMessage threw", error);
  }
}

/** A post is retried only once it is this old, so a retry never races the request that is still sending it. */
const RETRY_AFTER_MS = 2 * 60 * 1000;
/** ...and not once it is this old: a message that stale would arrive in Slack out of context. */
const RETRY_UNTIL_MS = 24 * 60 * 60 * 1000;
const RETRY_BATCH = 50;

/**
 * The outbox's retry (nightly chat run): app messages still pending or failed, oldest first so
 * they reach Slack in the order they were written. Returns how many were sent.
 */
export async function retryUnsentChatMessages(supabase: SupabaseClient): Promise<{ sent: number; failed: number }> {
  const now = clock.now();
  const { data } = await supabase
    .from("chat_messages")
    .select("id")
    .eq("origin", "app")
    .in("slack_sync_status", ["pending", "failed"])
    .is("deleted_at", null)
    .lt("created_at", new Date(now - RETRY_AFTER_MS).toISOString())
    .gt("created_at", new Date(now - RETRY_UNTIL_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(RETRY_BATCH);

  let sent = 0;
  let failed = 0;
  for (const { id } of data ?? []) {
    const result = await sendChatMessageToSlack(supabase, id as string);
    if (result === "sent") sent++;
    else if (result === "failed") failed++;
  }
  return { sent, failed };
}
