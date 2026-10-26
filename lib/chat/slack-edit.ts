import { WebClient } from "@slack/web-api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatSlackWritesEnabled, escapeForSlack, hubMessageMetadata } from "@/lib/chat/slack-post";
import { getSlackUserToken, isDeadTokenError } from "@/lib/slack-connect";

/**
 * Changing or removing a message in Slack, for editing and deleting your own messages
 * (docs/SLACK_BRIDGED_CHAT.md). Slack only lets whoever posted a message change it, so this uses the
 * same identity the post used: the member's own token, whether the message was written in the Hub or in
 * Slack itself (a message the bot posted for a member before chat required a connection can't be changed).
 * Service role. The Hub's own copy is changed afterwards (chat_edit_message / chat_delete_message), so it
 * never says something Slack doesn't.
 */

export type SlackWriteResult = { ok: true } | { ok: false; error: string };

interface Target {
  origin: string;
  system_subtype: string | null;
  author_member_id: string | null;
  posted_via: string | null;
  slack_ts: string | null;
  deleted_at: string | null;
  chat_channels: { slack_channel_id: string | null } | { slack_channel_id: string | null }[] | null;
}

const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * Which token may change this message, or why none can: null `token` with no error means the
 * message never reached Slack and there is nothing to change there.
 */
async function writerFor(
  supabase: SupabaseClient,
  messageId: string,
  memberId: string,
  what: "edited" | "deleted"
): Promise<{ ok: false; error: string } | { ok: true; slack: { token: string; channel: string; ts: string; native: boolean } | null }> {
  const { data } = await supabase
    .from("chat_messages")
    .select("origin, system_subtype, author_member_id, posted_via, slack_ts, deleted_at, chat_channels(slack_channel_id)")
    .eq("id", messageId)
    .maybeSingle();
  const row = data as Target | null;
  if (!row || row.system_subtype || row.author_member_id !== memberId || (what === "edited" && row.deleted_at)) {
    return { ok: false, error: `That message can't be ${what}.` };
  }
  const channel = one(row.chat_channels)?.slack_channel_id;
  if (!row.slack_ts || !channel) return { ok: true, slack: null };
  if (!chatSlackWritesEnabled()) return { ok: false, error: `Messages in Slack can only be ${what} from the live Hub.` };

  // A message written in Slack, or in the Hub with the member's own token, was posted as them: only their
  // token can change it.
  if (row.origin === "slack" || row.posted_via === "user_token") {
    const connection = await getSlackUserToken(supabase, memberId);
    if (!connection) return { ok: false, error: `${row.posted_via === "user_token" ? "Reconnect" : "Connect"} Slack in Settings to have this message ${what}: it was posted as you.` };
    return { ok: true, slack: { token: connection.token, channel, ts: row.slack_ts, native: row.origin === "slack" } };
  }
  // Posted by the bot, from before chat required a connected account: only the bot could change it, and the
  // bot no longer acts for a member.
  return { ok: false, error: `That message was posted by Billie Bot, so it can't be ${what} here.` };
}

const slackError = (error: unknown): string | undefined => (error as { data?: { error?: string } } | null)?.data?.error;

/** Replace the text of one of the member's Hub messages in Slack (nothing to do for one that never got there). */
export async function updateChatMessageInSlack(
  supabase: SupabaseClient,
  opts: { messageId: string; memberId: string; body: string }
): Promise<SlackWriteResult> {
  const writer = await writerFor(supabase, opts.messageId, opts.memberId, "edited");
  if (!writer.ok) return writer;
  if (!writer.slack) return { ok: true };
  const { token, channel, ts, native } = writer.slack;
  try {
    // A message written in the Hub is plain text we escape and tag as ours. One written in Slack is Slack's own
    // mrkdwn (the member edits that text), sent as it is; an update with text and no blocks drops the old
    // rich-text blocks, so the new text is what shows.
    const result = await new WebClient(token).chat.update(
      native
        ? { channel, ts, text: opts.body, blocks: [] }
        : { channel, ts, text: escapeForSlack(opts.body), metadata: hubMessageMetadata(opts.messageId) }
    );
    return result.ok ? { ok: true } : { ok: false, error: "Slack didn't take the edit. Try again in a moment." };
  } catch (error) {
    if (isDeadTokenError(error)) {
      await supabase.rpc("slack_connection_revoke", { p_member: opts.memberId });
      return { ok: false, error: "Reconnect Slack in Settings to edit this message: it was posted as you." };
    }
    const code = slackError(error);
    console.error("chat.update failed for %s:", opts.messageId, code ?? error);
    if (code === "message_not_found") return { ok: false, error: "That message is no longer in Slack." };
    if (code === "cant_update_message" || code === "edit_window_closed") return { ok: false, error: "Slack won't let this message be edited any more." };
    return { ok: false, error: "Slack didn't take the edit. Try again in a moment." };
  }
}

/** Delete one of the member's Hub messages in Slack. Already gone there counts as done. */
export async function deleteChatMessageInSlack(
  supabase: SupabaseClient,
  opts: { messageId: string; memberId: string }
): Promise<SlackWriteResult> {
  const writer = await writerFor(supabase, opts.messageId, opts.memberId, "deleted");
  if (!writer.ok) return writer;
  if (!writer.slack) return { ok: true };
  const { token, channel, ts } = writer.slack;
  try {
    const result = await new WebClient(token).chat.delete({ channel, ts });
    return result.ok ? { ok: true } : { ok: false, error: "Slack didn't delete it. Try again in a moment." };
  } catch (error) {
    if (isDeadTokenError(error)) {
      await supabase.rpc("slack_connection_revoke", { p_member: opts.memberId });
      return { ok: false, error: "Reconnect Slack in Settings to delete this message: it was posted as you." };
    }
    const code = slackError(error);
    if (code === "message_not_found") return { ok: true };
    console.error("chat.delete failed for %s:", opts.messageId, code ?? error);
    if (code === "cant_delete_message") return { ok: false, error: "Slack won't let this message be deleted." };
    return { ok: false, error: "Slack didn't delete it. Try again in a moment." };
  }
}

/** Delete one file of the member's Hub message in Slack (files.delete). Already gone there counts as done. */
export async function deleteChatFileInSlack(
  supabase: SupabaseClient,
  opts: { messageId: string; memberId: string; fileId: string }
): Promise<SlackWriteResult> {
  const writer = await writerFor(supabase, opts.messageId, opts.memberId, "deleted");
  if (!writer.ok) return writer;
  if (!writer.slack) return { ok: true };
  try {
    const result = await new WebClient(writer.slack.token).files.delete({ file: opts.fileId });
    return result.ok ? { ok: true } : { ok: false, error: "Slack didn't delete the file. Try again in a moment." };
  } catch (error) {
    if (isDeadTokenError(error)) {
      await supabase.rpc("slack_connection_revoke", { p_member: opts.memberId });
      return { ok: false, error: "Reconnect Slack in Settings to delete this file: it was posted as you." };
    }
    const code = slackError(error);
    if (code === "file_not_found" || code === "file_deleted") return { ok: true };
    console.error("files.delete failed for %s:", opts.fileId, code ?? error);
    return { ok: false, error: "Slack didn't delete the file. Try again in a moment." };
  }
}
