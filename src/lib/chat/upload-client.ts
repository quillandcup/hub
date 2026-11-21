import { prepareChatUploads } from "@/app/(member)/chat/actions";
import { SLACK_FILES_BUCKET } from "@/lib/slack-capture";
import type { StagedUpload } from "@/lib/chat/staging";
import { CHAT_UPLOAD_CONCURRENCY, runPool } from "@/lib/chat/upload-pool";
import { signedUploadUrl, uploadWithProgress } from "@/lib/chat/upload-progress";

/**
 * Uploads files from the browser to the member's staging folder (straight to Storage: a server action can't take a
 * big body), several at once, results in the order given. The first failure aborts the rest.
 */
export async function uploadStagedFiles(
  list: File[],
  signal: AbortSignal,
  onProgress: (file: File, index: number, loaded: number) => void = () => {}
): Promise<{ ok: true; uploads: StagedUpload[] } | { ok: false; error: string }> {
  const prepared = await prepareChatUploads(list.map((f) => ({ name: f.name || "file", size: f.size }))).catch(() => null);
  if (!prepared?.ok) return { ok: false, error: prepared?.error ?? "Couldn't start the upload. Try again." };
  const outcome = await runPool(
    list,
    CHAT_UPLOAD_CONCURRENCY,
    async (file, i, poolSignal) => {
      const { path, token } = prepared.uploads[i];
      const contentType = file.type || "application/octet-stream";
      const result = await uploadWithProgress({
        url: signedUploadUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!, SLACK_FILES_BUCKET, path, token),
        file,
        contentType,
        apiKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        signal: poolSignal,
        onProgress: (loaded) => onProgress(file, i, loaded),
      });
      if (!result.ok) return { ok: false as const, error: result.reason };
      return { ok: true as const, value: { path, name: file.name || "file", mimetype: contentType, size: file.size } };
    },
    signal
  );
  if (!outcome.ok) return { ok: false, error: outcome.aborted ? "aborted" : `Couldn't upload ${list[outcome.index].name}. Try again.` };
  return { ok: true, uploads: outcome.results };
}
