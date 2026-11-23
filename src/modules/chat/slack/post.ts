import { WebClient } from "@slack/web-api";
import { createSlackClient } from "@/lib/slack-client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SendOutcome } from "@/lib/chat/transport";
import { createRepos } from "@/lib/data/repos";
import type { Db } from "@/lib/data/db";
import { isProduction } from "@/lib/config";
import { membersWithFeature } from "@/lib/features.server";
import { getSlackUserToken, isDeadTokenError } from "@/lib/slack-connect";
import { parseChatFiles } from "@/lib/chat/files";
import { escapeForSlack } from "@/modules/chat/slack/escape";
import { reportRefusedBlocks } from "@/lib/chat/blocks-refused";
import { everyLinkBlocked } from "@/lib/chat/link-preview-blocks";
import { bodyToBlocks, isInvalidBlocks, needsBlocks, stripUnderline } from "@/modules/chat/slack/rich-blocks";
import { sendChatFilesToSlack } from "@/modules/chat/slack/upload";
import { sharedVideoSlackLine } from "@/lib/chat/video-link";

/**
 * The outbox's second step (docs/product/SLACK_BRIDGED_CHAT.md, "Hub -> Slack"): a message a member wrote
 * in the Hub is already in chat_messages as 'pending' (chat_post_message); this posts it to Slack
 * as the member (if they connected Slack) or as the bot under their name and photo, and stores the
 * ts Slack returns. Service role.
 */

export { escapeForSlack } from "@/modules/chat/slack/escape";

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

/**
 * Whether Slack may build its own link previews for this member's message. A message a member wrote is conversation, so (unlike
 * everything the app sends on its own, which never unfurls: .claude/rules/member-notifications.md, "Notification Messages") Slack readers should see it as an ordinary
 * Slack message. Behind `chat_link_previews` for the sender, like the Hub's own previews, so a flag that is off changes nothing; a failed
 * lookup means no unfurling rather than a lost message.
 */
export async function slackMayUnfurlFor(supabase: SupabaseClient, memberId: string): Promise<boolean> {
  try {
    return (await membersWithFeature(createRepos(supabase as unknown as Db), "chat_link_previews", [memberId])).has(memberId);
  } catch (error) {
    console.error("slackMayUnfurlFor: flag lookup failed for member %s:", memberId, error instanceof Error ? error.message : error);
    return false;
  }
}

async function blockedEverywhere(supabase: SupabaseClient, memberId: string, body: string): Promise<boolean> {
  try {
    return everyLinkBlocked(body, await createRepos(supabase as unknown as Db).chatLinkPreviews.blocksOf(memberId));
  } catch (error) {
    console.error("sendChatMessageToSlack: blocked previews lookup failed for member %s:", memberId, error instanceof Error ? error.message : error);
    return false;
  }
}


/**
 * Posts one pending (or failed) app message to Slack. Skips anything already sent, not ours, or
 * deleted, and does nothing off production (see chatSlackWritesEnabled).
 *
 * As the member, with their own Slack token (no "APP" tag, editable in Slack): chat requires a connected
 * account, so there is no bot fallback. Without one, or when Slack says the token is dead (which also revokes
 * the connection, so the member is sent to reconnect), the message is marked failed and stays in the Hub with
 * its Retry, which works once they have reconnected.
 */
export async function postChatMessageToSlack(supabase: SupabaseClient, messageId: string): Promise<SendOutcome> {
  const chat = createRepos(supabase as unknown as Db).chat;
  const row = await chat.outboxMessage(messageId);
  if (!row || row.origin !== "app" || row.slackSyncStatus === "sent" || row.deletedAt) return { status: "skipped" };

  if (!chatSlackWritesEnabled()) {
    console.warn("sendChatMessageToSlack: not production, leaving message %s pending", messageId);
    return { status: "skipped" };
  }

  // Nothing is written here: a failure is logged and answered, and core marks the message failed (src/lib/chat/delivery.ts).
  const fail = async (reason: string, error?: unknown): Promise<SendOutcome> => {
    console.error("sendChatMessageToSlack: %s (message %s)", reason, messageId, error ?? "");
    return { status: "failed" };
  };

  const body = row.body;
  const files = parseChatFiles(row.files, { staged: true });
  const slackChannelId = row.slackChannelId;
  if ((!body && files.length === 0) || !slackChannelId || !row.authorMemberId) return fail("message is missing its body, channel or author");

  // Everything the post needs, read at once: the thread root's ts and the member's Slack connection.
  const authorMemberId = row.authorMemberId;
  const [root, connection, mayUnfurl] = await Promise.all([
    row.threadRootId ? chat.slackTarget(row.threadRootId) : Promise.resolve(null),
    getSlackUserToken(supabase, authorMemberId),
    slackMayUnfurlFor(supabase, authorMemberId),
  ]);

  // When the author blocked every link in the message, Slack has nothing to unfurl that they wanted. A message with some other link still
  // unfurls as a whole (Slack has no per-link switch; docs/TODO.md, "Chat: Link Preview Blocks In Slack"). A failed lookup leaves the flag's answer.
  const unfurl = mayUnfurl && !(await blockedEverywhere(supabase, authorMemberId, body));

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
      fail,
    });
  }

  if (!connection) return fail("the member has no working Slack connection");

  // A message that shares a lesson video says so in Slack with links back to the Hub (Slack can't play it; docs/TODO.md,
  // "Chat: Watch Videos In The Conversation"). A failed lookup sends the message without them rather than not at all.
  const videoLine = await sharedVideoSlackLine(createRepos(supabase as unknown as Db), messageId, slackChannelId).catch((error) => {
    console.error("sendChatMessageToSlack: shared video links failed for %s:", messageId, error);
    return null;
  });
  const slackText = (text: string) => escapeForSlack(stripUnderline(text)) + (videoLine ?? "");

  let result: Awaited<ReturnType<WebClient["chat"]["postMessage"]>>;
  try {
    const client = createSlackClient(connection.token);
    const post = (blocks: boolean) =>
      client.chat.postMessage({
        channel: slackChannelId,
        text: slackText(body),
        // An underline or a list has no mrkdwn, so a message with one goes as rich-text blocks (its text, minus the underline, is the fallback).
        ...(blocks ? { blocks: bodyToBlocks(body, { plain: true }) } : {}),
        thread_ts: threadTs,
        // The links we add to a shared video can only be previewed as the sign-in page, so such a message goes without previews.
        unfurl_links: unfurl && !videoLine,
        unfurl_media: unfurl && !videoLine,
        metadata: hubMessageMetadata(messageId),
      });
    // The links are part of the text, so a shared video goes as plain text even when the words would otherwise need blocks.
    const withBlocks = needsBlocks(body) && !videoLine;
    try {
      result = await post(withBlocks);
    } catch (error) {
      // Slack refusing the blocks must not lose the message: it goes as plain text instead.
      if (!withBlocks || !isInvalidBlocks(error)) throw error;
      console.error("sendChatMessageToSlack: Slack refused the blocks for message %s, sending it as text", messageId);
      await reportRefusedBlocks(createRepos(supabase as unknown as Db), "post", messageId, error);
      result = await post(false);
    }
  } catch (error) {
    if (isDeadTokenError(error)) {
      console.error("Slack token for member %s is dead, revoking it", authorMemberId);
      await supabase.rpc("slack_connection_revoke", { p_member: authorMemberId });
      return fail("the member's Slack token is dead");
    }
    return fail("chat.postMessage as the member threw", error);
  }

  if (!result.ok || !result.ts) return fail("Slack did not return a ts");
  // Core records the ts and how it was posted; a failure to record leaves it pending so Slack's own event can still link it.
  return { status: "sent", ref: result.ts, via: "user_token" };
}
