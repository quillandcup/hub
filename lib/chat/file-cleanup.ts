import type { SupabaseClient } from "@supabase/supabase-js";
import { clock } from "@/lib/clock";
import { SLACK_FILES_BUCKET } from "@/lib/slack-capture";

export type FileBytesResult = "removed" | "kept" | "nothing" | "failed";

/** Marks the file as deliberately gone, so the import's copy step (which skips "skipped:" errors) never re-fetches it. */
const DELETED_COPY_ERROR = "skipped: deleted";

/**
 * After a file left a Hub message's list: soft-delete its Bronze row and remove its bytes from the
 * private bucket, unless another message still lists the same file. Safe to call after the Slack
 * delete and the list update; a failed removal is logged and left for `sweepDeletedFileBytes`
 * (deleted_at set, storage_path still set). `service` must be a service-role client.
 */
export async function removeChatFileBytes(service: SupabaseClient, fileId: string): Promise<FileBytesResult> {
  try {
    const { data: refs, error: refError } = await service.from("chat_message_contents").select("message_id").contains("files", [{ id: fileId }]).limit(1);
    if (refError) throw refError;
    if (refs && refs.length > 0) return "kept";

    const bronze = () => service.schema("bronze").from("slack_files");
    const { data: row, error: rowError } = await bronze().select("storage_path, deleted_at").eq("file_id", fileId).maybeSingle();
    if (rowError) throw rowError;
    if (!row) return "nothing";

    if (!row.deleted_at) {
      const { error } = await bronze()
        .update({ deleted_at: new Date(clock.now()).toISOString(), copy_error: DELETED_COPY_ERROR })
        .eq("file_id", fileId);
      if (error) throw error;
    }
    return (await dropBytes(service, fileId, row.storage_path)) ? "removed" : "failed";
  } catch (error) {
    console.error("removing the bytes of chat file %s failed:", fileId, error);
    return "failed";
  }
}

async function dropBytes(service: SupabaseClient, fileId: string, path: string | null): Promise<boolean> {
  if (path) {
    const { error } = await service.storage.from(SLACK_FILES_BUCKET).remove([path]);
    if (error) {
      console.error("removing %s from the %s bucket failed:", path, SLACK_FILES_BUCKET, error);
      return false;
    }
  }
  const { error } = await service.schema("bronze").from("slack_files").update({ storage_path: null, copied_at: null }).eq("file_id", fileId);
  if (error) {
    console.error("clearing storage_path of file %s failed:", fileId, error);
    return false;
  }
  return true;
}

/** Retry removals that failed earlier: soft-deleted Bronze files whose bytes are still in the bucket. */
export async function sweepDeletedFileBytes(service: SupabaseClient, limit = 100): Promise<{ removed: number; failed: number }> {
  const { data, error } = await service
    .schema("bronze")
    .from("slack_files")
    .select("file_id, storage_path")
    .not("deleted_at", "is", null)
    .not("storage_path", "is", null)
    .order("deleted_at")
    .limit(limit);
  if (error) {
    console.error("listing deleted chat files to sweep failed:", error);
    return { removed: 0, failed: 1 };
  }
  let removed = 0;
  let failed = 0;
  for (const row of data ?? []) {
    if (await dropBytes(service, row.file_id, row.storage_path)) removed++;
    else failed++;
  }
  return { removed, failed };
}
