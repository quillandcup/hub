import { WebClient } from "@slack/web-api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clock } from "@/lib/clock";
import { createRepos } from "@/lib/data/repos";
import type { Db } from "@/lib/data/db";
import { isProduction } from "@/lib/config";
import { getSlackUserToken, isDeadTokenError } from "@/lib/slack-connect";
import { parseChatFiles } from "@/lib/chat/files";
import { sendChatFilesToSlack } from "@/lib/chat/slack-upload";

/**
 * The outbox's second step (docs/SLACK_BRIDGED_CHAT.md, "Hub -> Slack"): a message a member wrote
 * in the Hub is already in chat_messages as 'pending' (chat_post_message); this posts it to Slack
 * as the member (if they connected Slack) or as the bot under their name and photo, and stores the
 * ts Slack returns. Service role.
 */

/**
 * Hub text is plain; Slack's mrkdwn treats these three characters as syntax. The one markup a Hub message
 * carries is a mention or channel the member picked (`<@U123>`, `<#C123>`), kept so Slack makes it a real one;
 * anything else in angle brackets, `<!channel>` and links included, is escaped like the rest.
 */
export function escapeForSlack(text: string): string {
  return text.replace(/<(@[A-Z0-9]+|#[A-Z0-9]+)>|[&<>]/g, (match, token?: string) =>
    token ? match : match === "&" ? "&amp;" : match === "<" ? "&lt;" : "&gt;"
  );
}

/** Marks our own posts, so Slack's event for one is recognised as ours (chat_adopt_posted_message). */
export function hubMessageMetadata(messageId: string) {
  return { event_type: "hub_message", event_payload: { app_message_id: messageId } };
}

/**
 * Whether the Hub may write to the real Slack workspace (post, react): only the production deploy.
 * Not SLACK_TEST_MODE: that switch redirects member DMs in local and preview environments. Chat is limited to members
 * who have the chat_posting preview. Local and preview deploys never write to Slack, so a dev or
 * preview session can't post into a real channel; the message stays pending.
 */
export function chatSlackWritesEnabled(): boolean {
  return isProduction;
}

export type SendResult = "sent" | "skipped" | "failed";

/**
 * Posts one pending (or failed) app message to Slack. Skips anything already sent, not ours, or
 * deleted, and does nothing off production (see chatSlackWritesEnabled).
 *
 * As the member, with their own Slack token (no "APP" tag, editable in Slack): chat requires a connected
 * account, so there is no bot fallback. Without one, or when Slack says the token is dead (which also revokes
 * the connection, so the member is sent to reconnect), the message is marked failed and stays in the Hub with
 * its Retry, which works once they have reconnected.
 */
export async function sendChatMessageToSlack(supabase: SupabaseClient, messageId: string): Promise<SendResult> {
  const chat = createRepos(supabase as unknown as Db).chat;
  const row = await chat.outboxMessage(messageId);
  if (!row || row.origin !== "app" || row.slackSyncStatus === "sent" || row.deletedAt) return "skipped";

  if (!chatSlackWritesEnabled()) {
    console.warn("sendChatMessageToSlack: not production, leaving message %s pending", messageId);
    return "skipped";
  }

  const fail = async (reason: string, error?: unknown): Promise<SendResult> => {
    console.error("sendChatMessageToSlack: %s (message %s)", reason, messageId, error ?? "");
    // Best effort: a failure to record the failure must not hide the original reason.
    await chat.markFailed(messageId).catch((markError) => console.error("chat_mark_message_failed failed for %s:", messageId, markError));
    return "failed";
  };

  const body = row.body;
  const files = parseChatFiles(row.files, { staged: true });
  const slackChannelId = row.slackChannelId;
  if ((!body && files.length === 0) || !slackChannelId || !row.authorMemberId) return fail("message is missing its body, channel or author");

  // Everything the post needs, read at once: the thread root's ts and the member's Slack connection.
  const authorMemberId = row.authorMemberId;
  const [root, connection] = await Promise.all([
    row.threadRootId ? chat.slackTarget(row.threadRootId) : Promise.resolve(null),
    getSlackUserToken(supabase, authorMemberId),
  ]);

  let threadTs: string | undefined;
  if (row.threadRootId) {
    if (!root?.slackTs) return fail("thread root has no Slack ts");
    threadTs = root.slackTs;
  }

  if (files.length > 0) {
    return sendChatFilesToSlack({
      supabase,
      messageId,
      slackChannelId,
      threadTs,
      body,
      files,
      connection,
      authorMemberId,
      escape: escapeForSlack,
      fail: fail as (reason: string, error?: unknown) => Promise<"failed">,
    });
  }

  if (!connection) return fail("the member has no working Slack connection");

  let result: Awaited<ReturnType<WebClient["chat"]["postMessage"]>>;
  try {
    result = await new WebClient(connection.token).chat.postMessage({
      channel: slackChannelId,
      text: escapeForSlack(body),
      thread_ts: threadTs,
      unfurl_links: false,
      unfurl_media: false,
      metadata: hubMessageMetadata(messageId),
    });
  } catch (error) {
    if (isDeadTokenError(error)) {
      console.error("Slack token for member %s is dead, revoking it", authorMemberId);
      await supabase.rpc("slack_connection_revoke", { p_member: authorMemberId });
      return fail("the member's Slack token is dead");
    }
    return fail("chat.postMessage as the member threw", error);
  }

  if (!result.ok || !result.ts) return fail("Slack did not return a ts");
  // How it was posted is a nicety (its failure is ignored); recording the ts is what matters.
  const [recorded] = await Promise.allSettled([chat.markSent(messageId, result.ts), chat.setPostedVia(messageId, "user_token")]);
  if (recorded.status === "rejected") {
    // Posted but not recorded: leave it pending (not failed) so Slack's own event can still link it.
    console.error("chat_mark_message_sent failed for %s:", messageId, recorded.reason instanceof Error ? recorded.reason.message : recorded.reason);
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
  const chat = createRepos(supabase as unknown as Db).chat;
  const expired = await chat.expireStalePending(new Date(now - RETRY_UNTIL_MS).toISOString());

  const ids = await chat.unsentMessageIds({
    createdBefore: new Date(now - RETRY_AFTER_MS).toISOString(),
    createdAfter: new Date(now - RETRY_UNTIL_MS).toISOString(),
    limit: RETRY_BATCH,
  });

  let sent = 0;
  let failed = 0;
  for (const id of ids) {
    const result = await sendChatMessageToSlack(supabase, id);
    if (result === "sent") sent++;
    else if (result === "failed") failed++;
  }
  return { sent, failed, expired };
}
