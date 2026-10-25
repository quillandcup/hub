import { WebClient } from "@slack/web-api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clock } from "@/lib/clock";
import { isDeadTokenError } from "@/lib/slack-connect";
import { SLACK_FILES_BUCKET, slackFileStoragePath } from "@/lib/slack-capture";
import { PENDING_FILE_PREFIX, type ChatFile } from "@/lib/chat/files";

/**
 * The file half of the outbox (docs/SLACK_BRIDGED_CHAT.md, "Files"): a message with files goes to
 * Slack through the file upload API, not chat.postMessage. Slack makes the message from the upload
 * (the text is the upload's comment), and that message can't carry our metadata, so we find its ts
 * through the file (files.info) and match Slack's own event by file id (chat_adopt_posted_file_message).
 *
 * Idempotent across retries: once Slack has the files their real ids are stored on the message,
 * and a retry only looks for the ts again; it never uploads a second copy.
 */

export interface FileSendContext {
  supabase: SupabaseClient;
  messageId: string;
  slackChannelId: string;
  threadTs?: string;
  body: string;
  files: ChatFile[];
  connection: { token: string } | null;
  authorMemberId: string;
  escape: (text: string) => string;
  fail: (reason: string, error?: unknown) => Promise<"failed">;
}

const TS_LOOKUP_ATTEMPTS = 4;
const TS_LOOKUP_WAIT_MS = 700;

/** Ids Slack gave the uploaded files, in upload order (v2 nests them one level per upload). */
export function uploadedFileIds(result: unknown): string[] {
  const ids: string[] = [];
  for (const entry of (result as { files?: unknown[] } | null)?.files ?? []) {
    const nested = (entry as { files?: { id?: string }[] })?.files;
    if (Array.isArray(nested)) {
      for (const f of nested) if (f?.id) ids.push(f.id);
    } else if ((entry as { id?: string })?.id) {
      ids.push((entry as { id: string }).id);
    }
  }
  return ids;
}

/** The ts of the message a file was shared in, once Slack has shared it (it can take a moment). */
export async function lookupFileMessageTs(botToken: string, fileId: string, slackChannelId: string): Promise<string | null> {
  const client = new WebClient(botToken);
  for (let attempt = 0; attempt < TS_LOOKUP_ATTEMPTS; attempt++) {
    if (attempt > 0) await clock.sleep(TS_LOOKUP_WAIT_MS);
    try {
      const info = await client.files.info({ file: fileId });
      const shares = (info.file?.shares ?? {}) as Record<string, Record<string, { ts?: string }[]>>;
      const ts = shares.public?.[slackChannelId]?.[0]?.ts ?? shares.private?.[slackChannelId]?.[0]?.ts;
      if (ts) return ts;
    } catch (error) {
      console.error("files.info failed for %s:", fileId, error);
    }
  }
  return null;
}

export async function sendChatFilesToSlack(ctx: FileSendContext): Promise<"sent" | "failed"> {
  const { supabase, messageId, slackChannelId, files } = ctx;
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) return ctx.fail("SLACK_BOT_TOKEN not configured");

  let ids = files.map((f) => f.id);
  let postedVia: "user_token" | "bot" | null = null;
  const bytes = new Map<string, Buffer>();

  if (files.some((f) => f.id.startsWith(PENDING_FILE_PREFIX))) {
    const uploads: { file: Buffer; filename: string }[] = [];
    for (const f of files) {
      if (!f.staged) return ctx.fail(`file ${f.name} has no staged copy`);
      const { data, error } = await supabase.storage.from(SLACK_FILES_BUCKET).download(f.staged);
      if (error || !data) return ctx.fail(`staged file ${f.staged} is gone`, error);
      const buffer = Buffer.from(await data.arrayBuffer());
      bytes.set(f.staged, buffer);
      uploads.push({ file: buffer, filename: f.name ?? "file" });
    }

    const upload = (token: string, comment: string) =>
      new WebClient(token).filesUploadV2({
        channel_id: slackChannelId,
        thread_ts: ctx.threadTs,
        initial_comment: comment || undefined,
        file_uploads: uploads,
      });

    // As the member, with their own token: chat requires a connected account, so the bot never uploads for
    // them. Without a working connection nothing is uploaded and the message waits for a Retry.
    if (!ctx.connection) return ctx.fail("the member has no working Slack connection");
    let result: Awaited<ReturnType<typeof upload>>;
    try {
      result = await upload(ctx.connection.token, ctx.escape(ctx.body));
      postedVia = "user_token";
    } catch (error) {
      // A dead token, or one connected before the Hub asked to upload files for the member (missing_scope):
      // either way they reconnect (the gate sends them to Settings), and Retry then sends it.
      const code = (error as { data?: { error?: string } })?.data?.error;
      if (isDeadTokenError(error) || code === "missing_scope") {
        console.error("Slack token for member %s can't upload (%s), revoking it", ctx.authorMemberId, code ?? "dead");
        await supabase.rpc("slack_connection_revoke", { p_member: ctx.authorMemberId });
        return ctx.fail("the member's Slack token can't upload");
      }
      return ctx.fail("filesUploadV2 as the member threw", error);
    }

    ids = uploadedFileIds(result);
    if (ids.length !== files.length) return ctx.fail(`Slack returned ${ids.length} files for ${files.length}`);

    // Slack has them: keep their real ids on the message at once (a retry must never upload again,
    // and Slack's event is matched by these), then point the bytes at the permanent copies.
    const stored = files.map((f, i) => ({ id: ids[i], name: f.name, mimetype: f.mimetype, size: f.size, width: f.width, height: f.height }));
    const { error: storeError } = await supabase.from("chat_message_contents").update({ files: stored }).eq("message_id", messageId);
    if (storeError) console.error("storing Slack file ids failed for %s:", messageId, storeError.message);
    ctx.files = stored;
  }

  const ts = await lookupFileMessageTs(botToken, ids[0], slackChannelId);
  if (!ts) {
    // Uploaded but not found yet: leave it pending. Slack's own event links it by file id, and a retry only looks again.
    console.error("no Slack ts yet for the files of message %s", messageId);
    return "sent";
  }

  const [{ error }] = await Promise.all([
    supabase.rpc("chat_mark_message_sent", { p_message_id: messageId, p_slack_ts: ts }),
    postedVia ? supabase.from("chat_messages").update({ posted_via: postedVia }).eq("id", messageId) : null,
  ]);
  if (error) console.error("chat_mark_message_sent failed for %s:", messageId, error.message);

  if (bytes.size > 0) await keepCopies(supabase, ctx.files, files, bytes, slackChannelId, ts);
  return "sent";
}

/** The bytes are already in hand: save them as the permanent copies (so the Hub never asks Slack for its own upload) and drop the staged ones. */
async function keepCopies(
  supabase: SupabaseClient,
  sent: ChatFile[],
  staged: ChatFile[],
  bytes: Map<string, Buffer>,
  slackChannelId: string,
  ts: string
) {
  try {
    for (let i = 0; i < sent.length; i++) {
      const file = sent[i];
      const buffer = bytes.get(staged[i].staged ?? "");
      if (!buffer) continue;
      const path = slackFileStoragePath({ file_id: file.id, name: file.name });
      const { error } = await supabase.storage.from(SLACK_FILES_BUCKET).upload(path, buffer, { contentType: file.mimetype || "application/octet-stream", upsert: true });
      if (error) throw error;
      const { error: rowError } = await supabase.schema("bronze").from("slack_files").upsert(
        {
          file_id: file.id,
          channel_id: slackChannelId,
          message_ts: ts,
          name: file.name,
          mimetype: file.mimetype,
          size_bytes: file.size,
          storage_path: path,
          copied_at: new Date(clock.now()).toISOString(),
          raw_payload: { id: file.id, name: file.name, mimetype: file.mimetype, size: file.size, source: "hub_upload" },
        },
        { onConflict: "file_id" }
      );
      if (rowError) throw rowError;
    }
    await supabase.storage.from(SLACK_FILES_BUCKET).remove([...bytes.keys()]);
  } catch (error) {
    // Not fatal: the files are in Slack, and the Hub copies them from there on first view.
    console.error("keeping copies of uploaded chat files failed:", error);
  }
}
