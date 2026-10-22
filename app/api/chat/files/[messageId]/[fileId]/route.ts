import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { ensureSlackFileCopied, SLACK_FILES_BUCKET } from "@/lib/slack-capture";
import { isInlineImage, parseChatFiles } from "@/lib/chat/files";

export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/**
 * A file on a chat message. The message's content row is read as the signed-in member, so the
 * same rules that let them read the text (RLS) decide whether they get the file; the bytes come
 * from the private bucket with the service role. Images are shown inline, everything else is sent
 * as a download so a stored page or script can never run on our origin.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ messageId: string; fileId: string }> }) {
  const { messageId, fileId } = await params;
  if (!UUID.test(messageId)) return notFound();

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const { data: content } = await supabase
    .from("chat_message_contents")
    .select("files, chat_messages(slack_ts, chat_channels(slack_channel_id))")
    .eq("message_id", messageId)
    .maybeSingle();
  const file = parseChatFiles(content?.files).find((f) => f.id === fileId);
  if (!content || !file) return notFound();

  const message: any = Array.isArray(content.chat_messages) ? content.chat_messages[0] : content.chat_messages;
  const channel: any = Array.isArray(message?.chat_channels) ? message.chat_channels[0] : message?.chat_channels;

  const service = createServiceRoleClient();
  const token = process.env.SLACK_BOT_TOKEN;
  const copy = await ensureSlackFileCopied(
    service,
    token ?? "",
    { fileId, channelId: channel?.slack_channel_id ?? "", messageTs: message?.slack_ts ?? "" }
  );
  if (!copy.ok) {
    console.error(`[chat] file ${fileId} unavailable: ${copy.reason}`);
    return notFound();
  }

  const { data: blob, error } = await service.storage.from(SLACK_FILES_BUCKET).download(copy.path);
  if (error || !blob) {
    console.error(`[chat] file ${fileId} missing from the bucket: ${error?.message}`);
    return notFound();
  }

  const mimetype = file.mimetype ?? copy.mimetype ?? "application/octet-stream";
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
