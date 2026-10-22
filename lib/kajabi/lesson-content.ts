/**
 * Lesson content from Kajabi's admin lesson editor (docs/COURSES.md, step B): the lesson HTML, its
 * thumbnail, its video source and its downloads. None of it is in Kajabi's public API; the editor
 * loads it as JSON (`/api/admin/posts/{id}` and `/api/admin/posts/{id}/downloads`), which
 * scripts/kajabi-course-content.ts records from a logged-in admin session and hands to this module.
 *
 * Writes go to the Bronze lesson row Step A created (content columns only, so a Step A re-run never
 * wipes them) and to bronze.kajabi_lesson_files. Re-running with unchanged content writes nothing.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The editor's lesson response (JSON:API); only the fields read here. */
export interface EditorPost {
  data: {
    id: string;
    attributes: {
      body?: string | null;
      posterImageUrl?: string | null;
    };
    relationships?: { media?: { data?: { id: string } | null } };
  };
  included?: Array<{ id: string; type: string; attributes: Record<string, unknown> }>;
}

/** The editor's downloads response; `meta` (the uploader's own config) is ignored. */
export interface EditorDownloads {
  data: Array<{
    id: string;
    attributes: {
      name?: string | null;
      displayName?: string | null;
      displayAssetName?: string | null;
      position?: number | null;
      assetUrl?: string | null;
      mediaLibraryAssetId?: number | null;
    };
  }>;
}

/** What step D needs to ingest a lesson's video. The link is a presigned S3 URL that expires. */
export interface LessonVideoSource {
  media_id: string;
  wistia_id: string | null;
  media_library_asset_id: number | null;
  /** Path of the original upload in Kajabi's bucket (the S3 key, not a link). */
  original_video: string | null;
  status: string | null;
  /** Presigned GET link, minted fresh each time the editor loads. Step D uses it before it expires. */
  download_url: string | null;
  download_url_expires_at: string | null;
}

export interface LessonFile {
  kajabi_id: string;
  filename: string;
  position: number;
  /** Presigned GET link; expires like the video's. */
  source_url: string | null;
  raw_payload: Record<string, unknown>;
}

export interface LessonContent {
  lessonId: string;
  bodyHtml: string | null;
  thumbnailUrl: string | null;
  videoMediaId: string | null;
  videoSource: LessonVideoSource | null;
  files: LessonFile[];
  /** Over what members would see, not over the expiring links. */
  contentHash: string;
}

/** When a presigned URL stops working, from its X-Amz-Date and X-Amz-Expires; null if not presigned. */
export function presignedExpiry(url: string | null | undefined): string | null {
  if (!url) return null;
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return null;
  }
  const date = params.get("X-Amz-Date");
  const seconds = Number(params.get("X-Amz-Expires"));
  const match = date && /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(date);
  if (!match || !Number.isFinite(seconds)) return null;
  const [, y, mo, d, h, mi, s] = match;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) + seconds * 1000).toISOString();
}

function withoutQuery(url: string | null): string | null {
  return url ? url.split("?")[0] : null;
}

export function parseLessonContent(post: EditorPost, downloads: EditorDownloads): LessonContent {
  const mediaRef = post.data.relationships?.media?.data;
  const video =
    post.included?.find((i) => i.type === "video" && (!mediaRef || i.id === mediaRef.id)) ?? null;

  const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  const urls = (video?.attributes.urls ?? {}) as Record<string, unknown>;
  const downloadUrl = str(urls.downloadUrl);

  const videoSource: LessonVideoSource | null = video
    ? {
        media_id: video.id,
        wistia_id: str(video.attributes.wistiaId),
        media_library_asset_id:
          typeof video.attributes.mediaLibraryAssetId === "number" ? video.attributes.mediaLibraryAssetId : null,
        original_video: str(video.attributes.originalVideo),
        status: str(video.attributes.status),
        download_url: downloadUrl,
        download_url_expires_at: presignedExpiry(downloadUrl),
      }
    : null;

  const files: LessonFile[] = downloads.data
    .map((d, index) => {
      const { assetUrl, ...rest } = d.attributes;
      return {
        kajabi_id: d.id,
        filename: str(d.attributes.name) ?? str(d.attributes.displayAssetName) ?? d.id,
        position: d.attributes.position ?? index,
        source_url: str(assetUrl),
        // The signed link lives in source_url; keep it out of the raw copy.
        raw_payload: { id: d.id, ...rest },
      };
    })
    .sort((a, b) => a.position - b.position);

  const bodyHtml = typeof post.data.attributes.body === "string" ? post.data.attributes.body : null;
  const thumbnailUrl = str(post.data.attributes.posterImageUrl);

  const contentHash = createHash("sha256")
    .update(
      JSON.stringify({
        body: bodyHtml,
        thumbnail: withoutQuery(thumbnailUrl),
        video: videoSource && [videoSource.media_id, videoSource.wistia_id, videoSource.original_video],
        files: files.map((f) => [f.kajabi_id, f.filename, f.position]),
      })
    )
    .digest("hex");

  return {
    lessonId: post.data.id,
    bodyHtml,
    thumbnailUrl,
    videoMediaId: videoSource?.media_id ?? null,
    videoSource,
    files,
    contentHash,
  };
}

/** Links expiring within this window are refreshed even when nothing else changed. */
export const URL_REFRESH_WINDOW_MS = 36 * 60 * 60 * 1000;

export type SaveOutcome = "updated" | "unchanged" | "urls_refreshed" | "missing";

interface LessonRow {
  kajabi_id: string;
  content_hash: string | null;
  video_source: LessonVideoSource | null;
}

/** Links that step D could still need are close to expiring (or already past it). */
export function linksNeedRefresh(row: Pick<LessonRow, "video_source">, now: Date): boolean {
  const expires = row.video_source?.download_url_expires_at;
  return !!expires && new Date(expires).getTime() - now.getTime() < URL_REFRESH_WINDOW_MS;
}

/**
 * Saves one lesson's captured content. Never creates a lesson (Step A owns the rows): a lesson
 * Bronze doesn't have yet comes back as "missing".
 *
 * @param dryRun work out the outcome without writing
 */
export async function saveLessonContent(
  supabase: SupabaseClient,
  content: LessonContent,
  now: Date,
  { dryRun = false }: { dryRun?: boolean } = {}
): Promise<SaveOutcome> {
  const bronze = supabase.schema("bronze");

  const { data: row, error } = await bronze
    .from("kajabi_course_lessons")
    .select("kajabi_id, content_hash, video_source")
    .eq("kajabi_id", content.lessonId)
    .is("deleted_at", null)
    .maybeSingle<LessonRow>();
  if (error) throw new Error(`kajabi_course_lessons: ${error.message}`);
  if (!row) return "missing";

  const unchanged = row.content_hash === content.contentHash;
  if (unchanged && !linksNeedRefresh(row, now)) return "unchanged";

  if (unchanged) {
    // Same lesson, but the stored links are about to stop working: take the fresh ones.
    if (!dryRun) await refreshLinks(supabase, content);
    return "urls_refreshed";
  }

  if (dryRun) return "updated";

  const stamp = now.toISOString();
  const { error: updateError } = await bronze
    .from("kajabi_course_lessons")
    .update({
      body_html: content.bodyHtml,
      thumbnail_url: content.thumbnailUrl,
      video_media_id: content.videoMediaId,
      video_source: content.videoSource,
      content_hash: content.contentHash,
      content_fetched_at: stamp,
    })
    .eq("kajabi_id", content.lessonId);
  if (updateError) throw new Error(`kajabi_course_lessons: ${updateError.message}`);

  await syncFiles(supabase, content, stamp);
  return "updated";
}

async function refreshLinks(supabase: SupabaseClient, content: LessonContent): Promise<void> {
  const bronze = supabase.schema("bronze");
  const { error } = await bronze
    .from("kajabi_course_lessons")
    .update({ video_source: content.videoSource })
    .eq("kajabi_id", content.lessonId);
  if (error) throw new Error(`kajabi_course_lessons: ${error.message}`);
  await Promise.all(
    content.files.map(async (f) => {
      const { error: fileError } = await bronze
        .from("kajabi_lesson_files")
        .update({ source_url: f.source_url })
        .eq("kajabi_id", f.kajabi_id);
      if (fileError) throw new Error(`kajabi_lesson_files: ${fileError.message}`);
    })
  );
}

/**
 * Mirrors the lesson's downloads: upsert what the editor returned (restoring any that had been
 * marked deleted), soft-delete what it no longer returns. Only called after a complete response.
 */
async function syncFiles(supabase: SupabaseClient, content: LessonContent, stamp: string): Promise<void> {
  const bronze = supabase.schema("bronze");

  if (content.files.length > 0) {
    const { error } = await bronze.from("kajabi_lesson_files").upsert(
      content.files.map((f) => ({
        kajabi_id: f.kajabi_id,
        lesson_kajabi_id: content.lessonId,
        filename: f.filename,
        source_url: f.source_url,
        raw_payload: f.raw_payload,
        fetched_at: stamp,
        deleted_at: null,
      })),
      { onConflict: "kajabi_id" }
    );
    if (error) throw new Error(`kajabi_lesson_files: ${error.message}`);
  }

  const { data: live, error: liveError } = await bronze
    .from("kajabi_lesson_files")
    .select("kajabi_id")
    .eq("lesson_kajabi_id", content.lessonId)
    .is("deleted_at", null);
  if (liveError) throw new Error(`kajabi_lesson_files: ${liveError.message}`);

  const keep = new Set(content.files.map((f) => f.kajabi_id));
  const gone = (live ?? []).map((r) => r.kajabi_id as string).filter((id) => !keep.has(id));
  if (gone.length > 0) {
    const { error } = await bronze.from("kajabi_lesson_files").update({ deleted_at: stamp }).in("kajabi_id", gone);
    if (error) throw new Error(`kajabi_lesson_files: ${error.message}`);
  }
}

export interface LessonTarget {
  kajabi_id: string;
  course_kajabi_id: string;
  title: string;
  publishing_option: string | null;
}

/**
 * The lessons to capture: live Bronze lessons of a course (or one lesson). Drafts are skipped
 * unless asked for, since Silver never shows them and some are unfinished.
 */
export async function selectLessons(
  supabase: SupabaseClient,
  scope: { courseId: string } | { lessonId: string },
  { includeDrafts = false }: { includeDrafts?: boolean } = {}
): Promise<LessonTarget[]> {
  const BATCH_SIZE = 1000;
  const all: LessonTarget[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    let query = supabase
      .schema("bronze")
      .from("kajabi_course_lessons")
      .select("kajabi_id, course_kajabi_id, title, publishing_option")
      .is("deleted_at", null)
      .order("kajabi_id");
    query = "courseId" in scope ? query.eq("course_kajabi_id", scope.courseId) : query.eq("kajabi_id", scope.lessonId);
    // neq alone would also drop rows where publishing_option is NULL.
    if (!includeDrafts) query = query.or("publishing_option.is.null,publishing_option.neq.draft");
    const { data, error } = await query.range(offset, offset + BATCH_SIZE - 1);
    if (error) throw new Error(`kajabi_course_lessons: ${error.message}`);
    if (data && data.length > 0) {
      all.push(...(data as LessonTarget[]));
      offset += data.length;
      hasMore = data.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }
  return all;
}
