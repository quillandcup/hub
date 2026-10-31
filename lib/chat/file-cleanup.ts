import type { SupabaseClient } from "@supabase/supabase-js";
import { clock } from "@/lib/clock";
import { createRepos } from "@/lib/data/repos";
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
export async function removeChatFileBytes(
  service: SupabaseClient,
  fileId: string,
  /** For a file Slack itself deleted: a message list may still name it (as a tombstone), but the file is gone at the source. */
  opts: { ignoreReferences?: boolean } = {}
): Promise<FileBytesResult> {
  try {
    if (!opts.ignoreReferences) {
      if (await createRepos(service).chat.fileIsListed(fileId)) return "kept";
    }

    const files = createRepos(service).slackMessages;
    const row = await files.fileById(fileId);
    if (!row) return "nothing";

    if (!row.deleted_at) {
      await files.updateFile(fileId, { deleted_at: new Date(clock.now()).toISOString(), copy_error: DELETED_COPY_ERROR });
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
  try {
    await createRepos(service).slackMessages.updateFile(fileId, { storage_path: null, copied_at: null });
  } catch (error) {
    console.error("clearing storage_path of file %s failed:", fileId, error);
    return false;
  }
  return true;
}

/** Retry removals that failed earlier: soft-deleted Bronze files whose bytes are still in the bucket. */
export async function sweepDeletedFileBytes(service: SupabaseClient, limit = 100): Promise<{ removed: number; failed: number }> {
  let rows: { file_id: string; storage_path: string }[];
  try {
    rows = await createRepos(service).slackMessages.deletedFilesWithBytes(limit);
  } catch (error) {
    console.error("listing deleted chat files to sweep failed:", error);
    return { removed: 0, failed: 1 };
  }
  let removed = 0;
  let failed = 0;
  for (const row of rows) {
    if (await dropBytes(service, row.file_id, row.storage_path)) removed++;
    else failed++;
  }
  return { removed, failed };
}

/**
 * Files Slack no longer has, judged from messages a run just fetched (their file lists are Slack's
 * current truth): a file shown as a tombstone, or one a fetched message used to list and no longer
 * does (the message was edited), and that no fetched message still lists. `stored` is the live Bronze
 * rows; a file we never stored is nothing to clean.
 */
export function filesGoneFromSlack(
  messages: { channel_id: string; message_ts: string; files?: any[] | null }[],
  stored: { file_id: string; channel_id: string; message_ts: string }[]
): string[] {
  const live = new Set<string>();
  const tombstoned = new Set<string>();
  const listedBy = new Map<string, Set<string>>();
  for (const m of messages) {
    const ids = new Set<string>();
    for (const f of m.files ?? []) {
      if (!f?.id) continue;
      ids.add(f.id);
      if (f.mode === "tombstone") tombstoned.add(f.id);
      else live.add(f.id);
    }
    listedBy.set(`${m.channel_id}|${m.message_ts}`, ids);
  }
  const gone: string[] = [];
  for (const row of stored) {
    if (live.has(row.file_id)) continue;
    const listed = listedBy.get(`${row.channel_id}|${row.message_ts}`);
    if (tombstoned.has(row.file_id) || (listed && !listed.has(row.file_id))) gone.push(row.file_id);
  }
  return gone;
}

/**
 * Pull-based half of "a file was deleted in Slack" (the `file_deleted` webhook is the fast half): soft-delete
 * the Bronze row of each file the fetched messages show as gone and remove its bytes. Bounded to `limit`
 * per run; the rest are found again by the next run. Returns counts for the import's report.
 */
export async function removeFilesGoneFromSlack(
  service: SupabaseClient,
  messages: { channel_id: string; message_ts: string; files?: any[] | null }[],
  limit = 200
): Promise<{ gone: number; removed: number; failed: number }> {
  if (messages.length === 0) return { gone: 0, removed: 0, failed: 0 };
  const oldest = messages.reduce((min, m) => (m.message_ts < min ? m.message_ts : min), messages[0].message_ts);
  const stored = await createRepos(service).slackMessages.liveFilesSince(oldest);
  const gone = filesGoneFromSlack(messages, stored).slice(0, limit);
  let removed = 0;
  let failed = 0;
  for (const fileId of gone) {
    const result = await removeChatFileBytes(service, fileId, { ignoreReferences: true });
    if (result === "failed") failed++;
    else removed++;
  }
  return { gone: gone.length, removed, failed };
}
