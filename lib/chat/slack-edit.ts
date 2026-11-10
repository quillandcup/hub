import { WebClient } from "@slack/web-api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import type { Db } from "@/lib/data/db";
import { chatSlackWritesEnabled, escapeForSlack, hubMessageMetadata } from "@/lib/chat/slack-post";
import { bodyToBlocks, isInvalidBlocks, needsBlocks, stripUnderline } from "@/lib/chat/rich-blocks";
import { reportRefusedBlocks } from "@/lib/chat/blocks-refused";
import { uploadedFileIds } from "@/lib/chat/slack-upload";
import { getSlackUserToken, isDeadTokenError } from "@/lib/slack-connect";

/**
 * Changing or removing a message in Slack, for editing and deleting your own messages
 * (docs/SLACK_BRIDGED_CHAT.md). Slack only lets whoever posted a message change it, so this uses the
 * same identity the post used: the member's own token, whether the message was written in the Hub or in
 * Slack itself (a message the bot posted for a member before chat required a connection can't be changed).
 * Service role. The Hub's own copy is changed afterwards (chat_edit_message / chat_delete_message), so it
 * never says something Slack doesn't.
 */

export type SlackWriteResult = { ok: true; fileIds?: string[] } | { ok: false; error: string };

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
  const row = await createRepos(supabase as unknown as Db).chat.slackTarget(messageId);
  if (!row || row.systemSubtype || row.authorMemberId !== memberId || (what === "edited" && row.deletedAt)) {
    return { ok: false, error: `That message can't be ${what}.` };
  }
  const channel = row.slackChannelId;
  if (!row.slackTs || !channel) return { ok: true, slack: null };
  if (!chatSlackWritesEnabled()) return { ok: false, error: `Messages in Slack can only be ${what} from the live Hub.` };

  // A message written in Slack, or in the Hub with the member's own token, was posted as them: only their
  // token can change it.
  if (row.origin === "slack" || row.postedVia === "user_token") {
    const connection = await getSlackUserToken(supabase, memberId);
    if (!connection) return { ok: false, error: `${row.postedVia === "user_token" ? "Reconnect" : "Connect"} Slack in Settings to have this message ${what}: it was posted as you.` };
    return { ok: true, slack: { token: connection.token, channel, ts: row.slackTs, native: row.origin === "slack" } };
  }
  // Posted by the bot, from before chat required a connected account: only the bot could change it, and the
  // bot no longer acts for a member.
  return { ok: false, error: `That message was posted by Billie Bot, so it can't be ${what} here.` };
}

const slackError = (error: unknown): string | undefined => (error as { data?: { error?: string } } | null)?.data?.error;

/** Replace the text of one of the member's Hub messages in Slack (nothing to do for one that never got there). */
export async function updateChatMessageInSlack(
  supabase: SupabaseClient,
  opts: { messageId: string; memberId: string; body: string; dropPreviews?: boolean; addFiles?: { existingIds: string[]; uploads: { file: Buffer; filename: string }[] } }
): Promise<SlackWriteResult> {
  const writer = await writerFor(supabase, opts.messageId, opts.memberId, "edited");
  if (!writer.ok) return writer;
  if (!writer.slack) return opts.addFiles?.uploads.length ? { ok: false, error: "This message isn't in Slack yet, so files can't be added." } : { ok: true };
  const { token, channel, ts, native } = writer.slack;
  try {
    // A message written in the Hub is plain text we escape and tag as ours. One written in Slack is Slack's own
    // mrkdwn (the member edits that text), sent as it is. An underline or a list has no mrkdwn, so a message that has one
    // goes as rich-text blocks (its text, minus the underline, is the fallback); any other update sends no blocks, which
    // drops the old rich-text blocks, so the new text is what shows (and a removed underline or list is gone).
    const client = new WebClient(token);
    // New files are uploaded as the member without sharing them anywhere (no channel_id), then attached by the edit:
    // chat.update's file_ids lists the message's files, so the ones it already has are named again beside the new ones.
    let fileIds: string[] | undefined;
    if (opts.addFiles?.uploads.length) {
      fileIds = uploadedFileIds(await client.filesUploadV2({ file_uploads: opts.addFiles.uploads }));
      if (fileIds.length !== opts.addFiles.uploads.length) return { ok: false, error: "Slack didn't take the files. Try again in a moment." };
    }
    const withFiles = fileIds ? { file_ids: [...opts.addFiles!.existingIds, ...fileIds] } : {};
    // chat.update has no switch to keep Slack from unfurling a link, but an empty attachments list removes the previews the message
    // already has (left alone otherwise: previews are kept through an ordinary edit). Used when the Hub rewrites a pasted lesson address.
    const previews = opts.dropPreviews ? { attachments: [] } : {};
    const update = (withBlocks: boolean) => {
      const blocks = withBlocks ? bodyToBlocks(opts.body, { plain: !native }) : [];
      return client.chat.update(
        native
          ? { channel, ts, text: stripUnderline(opts.body), blocks, ...previews, ...withFiles }
          : { channel, ts, text: escapeForSlack(stripUnderline(opts.body)), blocks, metadata: hubMessageMetadata(opts.messageId), ...previews, ...withFiles }
      );
    };
    const withBlocks = needsBlocks(opts.body);
    let result: Awaited<ReturnType<typeof update>>;
    try {
      result = await update(withBlocks);
    } catch (error) {
      // Slack refusing the blocks must not lose the edit: it goes as plain text instead.
      if (!withBlocks || !isInvalidBlocks(error)) throw error;
      console.error("updateChatMessageInSlack: Slack refused the blocks for message %s, sending the edit as text", opts.messageId);
      await reportRefusedBlocks(createRepos(supabase as unknown as Db), "edit", opts.messageId, error);
      result = await update(false);
    }
    return result.ok ? { ok: true, ...(fileIds ? { fileIds } : {}) } : { ok: false, error: "Slack didn't take the edit. Try again in a moment." };
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
