import type { SupabaseClient } from "@supabase/supabase-js";
import type { DraftFile } from "@/lib/data/chat-drafts";
import { isOwnStagingPath } from "@/lib/chat/staging";
import { SLACK_FILES_BUCKET } from "@/lib/slack-capture";

/** A draft's file as the composer shows it: where it is staged, and a link to preview it when it is an image. */
export type DraftFileView = DraftFile & { url: string | null };

/** How long a preview link lasts: the box is open for a while, and a new page load makes new ones. */
const PREVIEW_SECONDS = 3600;

/**
 * Previews for a draft's files: a signed link for each image that is the member's own staged copy and
 * still in the bucket (the bucket is private). `service` must be a service-role client. Anything that
 * fails just has no preview; the file is still listed.
 */
export async function withPreviewUrls(service: SupabaseClient, memberId: string, files: DraftFile[]): Promise<DraftFileView[]> {
  const wanted = files.filter((f) => f.mimetype.startsWith("image/") && isOwnStagingPath(memberId, f.path));
  const urls = new Map<string, string>();
  if (wanted.length > 0) {
    const { data, error } = await service.storage.from(SLACK_FILES_BUCKET).createSignedUrls(
      wanted.map((f) => f.path),
      PREVIEW_SECONDS,
    );
    if (error) console.error("signing draft file previews failed:", error.message);
    for (const row of data ?? []) if (row.path && row.signedUrl) urls.set(row.path, row.signedUrl);
  }
  return files.map((f) => ({ ...f, url: urls.get(f.path) ?? null }));
}

/** The files a client sent for a draft that really are this member's staged paths, at most `max`; anything else is dropped. */
export function ownDraftFiles(memberId: string, files: unknown, max: number): DraftFile[] {
  if (!Array.isArray(files)) return [];
  return files
    .flatMap((f): DraftFile[] =>
      f && typeof f.path === "string" && typeof f.name === "string" && f.name && isOwnStagingPath(memberId, f.path) && Number.isFinite(f.size) && f.size >= 0
        ? [{ path: f.path, name: f.name.slice(0, 200), mimetype: typeof f.mimetype === "string" ? f.mimetype.slice(0, 100) : "application/octet-stream", size: f.size }]
        : [],
    )
    .slice(0, max);
}
