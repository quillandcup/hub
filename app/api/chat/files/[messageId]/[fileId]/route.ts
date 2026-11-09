import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { ensureSlackFileCopied, SLACK_FILES_BUCKET } from "@/lib/slack-capture";
import { PENDING_FILE_PREFIX, isInlineImage, parseChatFiles } from "@/lib/chat/files";
import { createRepos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";
import { slackFileToken } from "@/lib/chat/file-token";

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
  // A failed read counts as nothing readable (404), as it always has.
  const content = await createRepos(supabase).chat.fileContext(messageId).catch((error: Error) => {
    console.error("[chat] reading the file list of %s failed:", messageId, error.message);
    return null;
  });
  const file = parseChatFiles(content?.files, { staged: true }).find((f) => f.id === fileId);
  if (!content || !file) return notFound();

  const service = createServiceRoleClient();
  const fetchBytes = (from: string) => service.storage.from(SLACK_FILES_BUCKET).download(from);
  let storedType: string | null = null;
  /** Ask Slack for the file (and keep a copy of it): the last resort, for a file that came from Slack and has not been copied yet. */
  const fromSlack = async (): Promise<string | null> => {
    const token = await slackFileToken(service, user, content.slackChannelId);
    if (token === null) return null;
    const copy = await ensureSlackFileCopied(service, token, {
      fileId,
      channelId: content.slackChannelId ?? "",
      messageTs: content.slackTs ?? "",
    });
    if (!copy.ok) {
      console.error(`[chat] file ${fileId} unavailable: ${copy.reason}`);
      return null;
    }
    storedType = copy.mimetype;
    return copy.path;
  };

  // Where the bytes are, nearest first. A file the Hub sent itself is never asked of Slack while its own bytes are there: for a
  // couple of seconds after the upload Slack answers "not found" for it.
  let path: string;
  const pending = file.id.startsWith(PENDING_FILE_PREFIX);
  if (pending) {
    // Still being sent to Slack: the bytes are where the composer staged them.
    if (!file.staged) return notFound();
    path = file.staged;
  } else if (file.staged) {
    // Sent from the Hub: our permanent copy once there is one (made from Slack's own event), else the bytes we sent.
    const ours = await createRepos(service).slackMessages.fileById(fileId).catch(() => null);
    if (ours?.storage_path && !ours.deleted_at) {
      path = ours.storage_path;
      storedType = ours.mimetype;
    } else path = file.staged;
  } else {
    const slackPath = await fromSlack();
    if (!slackPath) return notFound();
    path = slackPath;
  }

  let { data: blob, error } = await fetchBytes(path);
  if ((error || !blob) && !pending && file.staged && path === file.staged) {
    // The staged bytes have been cleared away since, so Slack has the file by now.
    const slackPath = await fromSlack();
    if (slackPath) ({ data: blob, error } = await fetchBytes(slackPath));
  }
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
