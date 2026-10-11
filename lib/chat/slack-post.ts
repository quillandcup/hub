import { WebClient } from "@slack/web-api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clock } from "@/lib/clock";
import { isProduction } from "@/lib/config";
import { getSlackUserToken, isDeadTokenError } from "@/lib/slack-connect";

/**
 * The outbox's second step (docs/SLACK_BRIDGED_CHAT.md, "Hub -> Slack"): a message a member wrote
 * in the Hub is already in chat_messages as 'pending' (chat_post_message); this posts it to Slack
 * as the member (if they connected Slack) or as the bot under their name and photo, and stores the
 * ts Slack returns. Service role.
 */

/** Hub text is plain; Slack's mrkdwn treats these three characters as syntax. */
export function escapeForSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Marks our own posts, so Slack's event for one is recognised as ours (chat_adopt_posted_message). */
export function hubMessageMetadata(messageId: string) {
  return { event_type: "hub_message", event_payload: { app_message_id: messageId } };
}

/**
 * Whether the Hub may write to the real Slack workspace (post, react): only the production deploy.
 * Not SLACK_TEST_MODE: that switch redirects member DMs and production runs with it on, so chat
 * would never post, and turning it off would send real DMs. Chat is already limited to the members
 * who have the chat_posting preview. Local and preview deploys never write to Slack, so a dev or
 * preview session can't post into a real channel; the message stays pending.
 */
export function chatSlackWritesEnabled(): boolean {
  return isProduction;
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
 * deleted, and does nothing off production (see chatSlackWritesEnabled).
 *
 * As the member when they have connected Slack (their own token: no "APP" tag, editable in Slack),
 * else as the bot under their name and photo. A connected member's token that Slack says is dead
 * revokes the connection and the message goes out through the bot instead, so it isn't lost.
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

  if (!chatSlackWritesEnabled()) {
    console.warn("sendChatMessageToSlack: not production, leaving message %s pending", messageId);
    return "skipped";
  }

  const fail = async (reason: string, error?: unknown): Promise<SendResult> => {
    console.error("sendChatMessageToSlack: %s (message %s)", reason, messageId, error ?? "");
    await supabase.rpc("chat_mark_message_failed", { p_message_id: messageId });
    return "failed";
  };

  const body = one(row.chat_message_contents)?.body;
  const slackChannelId = one(row.chat_channels)?.slack_channel_id;
  if (!body || !slackChannelId || !row.author_member_id) return fail("message is missing its body, channel or author");

  // Everything the post needs, read at once: the thread root's ts, the member's Slack connection
  // and (for the bot path) their name and photo. Waiting on these one after another was a good
  // part of the time between pressing Send and the message reaching Slack.
  const authorMemberId = row.author_member_id;
  const [root, connection, author] = await Promise.all([
    row.thread_root_id
      ? supabase.from("chat_messages").select("slack_ts").eq("id", row.thread_root_id).maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
    getSlackUserToken(supabase, authorMemberId),
    supabase
      .from("member_directory")
      .select("name, display_name, photo_url")
      .eq("id", authorMemberId)
      .maybeSingle()
      .then((r) => r.data),
  ]);

  let threadTs: string | undefined;
  if (row.thread_root_id) {
    if (!root?.slack_ts) return fail("thread root has no Slack ts");
    threadTs = root.slack_ts;
  }

  const post = (token: string, identity?: { username?: string; icon_url?: string }) =>
    new WebClient(token).chat.postMessage({
      channel: slackChannelId,
      text: escapeForSlack(body),
      thread_ts: threadTs,
      ...identity,
      unfurl_links: false,
      unfurl_media: false,
      metadata: hubMessageMetadata(messageId),
    });

  let result: Awaited<ReturnType<typeof post>> | null = null;
  let postedVia: "user_token" | "bot" = "bot";

  // As the member, when they have connected Slack.
  if (connection) {
    try {
      result = await post(connection.token);
      postedVia = "user_token";
    } catch (error) {
      if (!isDeadTokenError(error)) return fail("chat.postMessage as the member threw", error);
      console.error("Slack token for member %s is dead, revoking and posting through the bot", row.author_member_id);
      await supabase.rpc("slack_connection_revoke", { p_member: row.author_member_id });
    }
  }

  // As the bot, under the member's name and photo.
  if (!result) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) return fail("SLACK_BOT_TOKEN not configured");
    const photo = author?.photo_url && /^https:\/\//.test(author.photo_url) ? author.photo_url : undefined;
    try {
      result = await post(token, { username: author?.display_name || author?.name || undefined, icon_url: photo });
    } catch (error) {
      return fail("chat.postMessage threw", error);
    }
  }

  if (!result.ok || !result.ts) return fail("Slack did not return a ts");
  const [{ error }] = await Promise.all([
    supabase.rpc("chat_mark_message_sent", { p_message_id: messageId, p_slack_ts: result.ts }),
    postedVia !== "bot" ? supabase.from("chat_messages").update({ posted_via: postedVia }).eq("id", messageId) : null,
  ]);
  if (error) {
    // Posted but not recorded: leave it pending (not failed) so Slack's own event can still link it.
    console.error("chat_mark_message_sent failed for %s:", messageId, error.message);
  }
  return "sent";
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
export async function retryUnsentChatMessages(supabase: SupabaseClient): Promise<{ sent: number; failed: number; expired: number }> {
  const now = clock.now();

  // A message still pending after the window will never be retried here, and "Sending…" forever
  // is a lie: mark it failed, so its author sees "Slack didn't get this" with a Retry button
  // (their call whether a day-old message is still worth sending). Its id is unchanged, so a
  // retry posts the same row; one whose Slack echo did arrive is already 'sent' and not touched.
  const { data: expiredRows } = await supabase
    .from("chat_messages")
    .update({ slack_sync_status: "failed" })
    .eq("origin", "app")
    .eq("slack_sync_status", "pending")
    .lte("created_at", new Date(now - RETRY_UNTIL_MS).toISOString())
    .select("id");
  const expired = expiredRows?.length ?? 0;

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
  return { sent, failed, expired };
}
