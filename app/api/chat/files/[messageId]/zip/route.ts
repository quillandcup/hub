import { NextRequest, NextResponse } from "next/server";
import { zipSync } from "fflate";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { ensureSlackFileCopied, SLACK_FILES_BUCKET } from "@/lib/slack-capture";
import { PENDING_FILE_PREFIX, parseChatFiles } from "@/lib/chat/files";
import { uniqueZipNames } from "@/lib/chat/zip-names";
import { isId } from "@/lib/ids";
import { getSlackBotToken } from "@/lib/slack-bot-token";

export const maxDuration = 300;

/** The zip is built in memory, so cap what goes into it. */
const MAX_ZIP_BYTES = 100 * 1024 * 1024;


const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/**
 * All of a message's files as one zip. The content row is read as the signed-in member (RLS decides
 * whether they may read the message), the bytes come from the private bucket with the service role.
 * Files that were deleted or whose bytes are gone are left out.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params;
  if (!isId(messageId, "msg")) return notFound();

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const { data: content } = await supabase
    .from("chat_message_contents")
    .select("files, chat_messages(slack_ts, chat_channels(slack_channel_id))")
    .eq("message_id", messageId)
    .maybeSingle();
  const files = parseChatFiles(content?.files, { staged: true });
  if (!content || files.length === 0) return notFound();

  const message: any = Array.isArray(content.chat_messages) ? content.chat_messages[0] : content.chat_messages;
  const channel: any = Array.isArray(message?.chat_channels) ? message.chat_channels[0] : message?.chat_channels;

  const service = createServiceRoleClient();
  const entries: { name: string | null; data: Uint8Array }[] = [];
  let total = 0;
  for (const file of files) {
    let path: string;
    if (file.id.startsWith(PENDING_FILE_PREFIX)) {
      if (!file.staged) continue;
      path = file.staged;
    } else {
      const copy = await ensureSlackFileCopied(service, (await getSlackBotToken()) ?? "", {
        fileId: file.id,
        channelId: channel?.slack_channel_id ?? "",
        messageTs: message?.slack_ts ?? "",
      });
      if (!copy.ok) {
        console.error(`[chat] zip: file ${file.id} unavailable: ${copy.reason}`);
        continue;
      }
      path = copy.path;
    }
    const { data: blob, error } = await service.storage.from(SLACK_FILES_BUCKET).download(path);
    if (error || !blob) {
      console.error(`[chat] zip: file ${file.id} missing from the bucket: ${error?.message}`);
      continue;
    }
    total += blob.size;
    if (total > MAX_ZIP_BYTES) return NextResponse.json({ error: "Attachments are too large to zip" }, { status: 413 });
    entries.push({ name: file.name, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  if (entries.length === 0) return notFound();

  const names = uniqueZipNames(entries.map((e) => e.name));
  const archive: Record<string, Uint8Array> = {};
  entries.forEach((e, i) => (archive[names[i]] = e.data));
  // Attachments are mostly images and archives already; storing is faster and barely bigger.
  const zipped = zipSync(archive, { level: 0 });

  return new NextResponse(new Blob([zipped as BlobPart]), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zipped.length),
      "Content-Disposition": 'attachment; filename="attachments.zip"',
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
