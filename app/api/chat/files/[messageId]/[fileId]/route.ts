import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { ensureSlackFileCopied, SLACK_FILES_BUCKET } from "@/lib/slack-capture";
import { PENDING_FILE_PREFIX, isInlineImage, parseChatFiles } from "@/lib/chat/files";
import { isId } from "@/lib/ids";
import { getSlackBotToken } from "@/lib/slack-bot-token";

export const maxDuration = 60;


const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/**
 * A file on a chat message. The message's content row is read as the signed-in member, so the
 * same rules that let them read the text (RLS) decide whether they get the file; the bytes come
 * from the private bucket with the service role. Images are shown inline, everything else is sent
 * as a download so a stored page or script can never run on our origin.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ messageId: string; fileId: string }> }) {
  const { messageId, fileId } = await params;
  if (!isId(messageId, "msg")) return notFound();

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const { data: content } = await supabase
    .from("chat_message_contents")
    .select("files, chat_messages(slack_ts, chat_channels(slack_channel_id))")
    .eq("message_id", messageId)
    .maybeSingle();
  const file = parseChatFiles(content?.files, { staged: true }).find((f) => f.id === fileId);
  if (!content || !file) return notFound();

  const message: any = Array.isArray(content.chat_messages) ? content.chat_messages[0] : content.chat_messages;
  const channel: any = Array.isArray(message?.chat_channels) ? message.chat_channels[0] : message?.chat_channels;

  const service = createServiceRoleClient();
  let path: string;
  let storedType: string | null = null;
  if (file.id.startsWith(PENDING_FILE_PREFIX)) {
    // Still being sent to Slack: the bytes are where the composer staged them.
    if (!file.staged) return notFound();
    path = file.staged;
  } else {
    const copy = await ensureSlackFileCopied(service, (await getSlackBotToken()) ?? "", {
      fileId,
      channelId: channel?.slack_channel_id ?? "",
      messageTs: message?.slack_ts ?? "",
    });
    if (!copy.ok) {
      console.error(`[chat] file ${fileId} unavailable: ${copy.reason}`);
      return notFound();
    }
    path = copy.path;
    storedType = copy.mimetype;
  }

  const { data: blob, error } = await service.storage.from(SLACK_FILES_BUCKET).download(path);
  if (error || !blob) {
    console.error(`[chat] file ${fileId} missing from the bucket: ${error?.message}`);
    return notFound();
  }

  const mimetype = file.mimetype ?? storedType ?? "application/octet-stream";
  const inline = isInlineImage({ mimetype });
  const filename = (file.name ?? "file").replace(/[^A-Za-z0-9._ -]+/g, "_");
  return new NextResponse(blob, {
    headers: {
      "Content-Type": inline ? mimetype : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
