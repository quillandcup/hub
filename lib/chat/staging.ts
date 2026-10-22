import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_SLACK_FILE_BYTES, SLACK_FILES_BUCKET } from "@/lib/slack-capture";

/**
 * Files a member attached in the composer wait in the private slack-files bucket under `staging/`
 * until the message is sent to Slack: the browser uploads straight to Storage (Vercel won't take a
 * request body over 4.5 MB), and the send reads them from there. Each path is
 * staging/<day>/<member id>-<random>/<file name>, so a member can only ever name their own.
 */

export const MAX_CHAT_FILES = 10;
export const MAX_CHAT_FILE_BYTES = MAX_SLACK_FILE_BYTES;
export const STAGING_PREFIX = "staging";
/** Staged files nobody sent (a cancelled attachment, a message that never went out) are deleted after this long. */
const STAGING_KEEP_DAYS = 3;

export interface StagedUpload {
  path: string;
  name: string;
  mimetype: string;
  size: number;
}

export function safeStagedName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120) || "file";
}

/** `nowMs` from clock.now(); the day only names a folder, it is not an org-day. */
export function newStagingPath(memberId: string, name: string, nowMs: number, random: string): string {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  return `${STAGING_PREFIX}/${day}/${memberId}-${random}/${safeStagedName(name)}`;
}

export function isOwnStagingPath(memberId: string, path: string): boolean {
  const escaped = memberId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${STAGING_PREFIX}/\\d{4}-\\d{2}-\\d{2}/${escaped}-[0-9a-f-]{36}/[A-Za-z0-9._-]+$`).test(path);
}

/** Delete staged files older than STAGING_KEEP_DAYS (nightly chat run). Returns how many it removed. */
export async function purgeStagedChatFiles(storage: SupabaseClient, nowMs: number): Promise<number> {
  const bucket = storage.storage.from(SLACK_FILES_BUCKET);
  const cutoff = new Date(nowMs - STAGING_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { data: days } = await bucket.list(STAGING_PREFIX, { limit: 1000 });
  let removed = 0;
  for (const day of days ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.name) || day.name >= cutoff) continue;
    const { data: folders } = await bucket.list(`${STAGING_PREFIX}/${day.name}`, { limit: 1000 });
    const paths: string[] = [];
    for (const folder of folders ?? []) {
      const { data: files } = await bucket.list(`${STAGING_PREFIX}/${day.name}/${folder.name}`, { limit: 100 });
      for (const f of files ?? []) paths.push(`${STAGING_PREFIX}/${day.name}/${folder.name}/${f.name}`);
    }
    if (paths.length > 0) {
      const { error } = await bucket.remove(paths);
      if (error) throw error;
      removed += paths.length;
    }
  }
  return removed;
}
