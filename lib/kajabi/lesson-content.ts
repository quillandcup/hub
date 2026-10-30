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
import { asJson } from "../data/json";
import { SupabaseKajabiCourseRepository, type LessonContentState, type LessonTarget } from "../data/kajabi-courses";
import type { Db } from "../data/db";

// Relative imports only: scripts/kajabi-course-content.ts runs this outside Next.
const coursesOf = (supabase: SupabaseClient) => new SupabaseKajabiCourseRepository(supabase as Db);

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

/** Links that step D could still need are close to expiring (or already past it). */
export function linksNeedRefresh(row: { video_source: LessonContentState["video_source"] | LessonVideoSource }, now: Date): boolean {
  const expires = (row.video_source as LessonVideoSource | null)?.download_url_expires_at;
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
  const repo = coursesOf(supabase);

  const row = await repo.contentState(content.lessonId);
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
  await repo.saveContent(content.lessonId, {
    body_html: content.bodyHtml,
    thumbnail_url: content.thumbnailUrl,
    video_media_id: content.videoMediaId,
    video_source: asJson(content.videoSource),
    content_hash: content.contentHash,
    content_fetched_at: stamp,
  });

  await syncFiles(supabase, content, stamp);
  return "updated";
}

async function refreshLinks(supabase: SupabaseClient, content: LessonContent): Promise<void> {
  const repo = coursesOf(supabase);
  await repo.setVideoSource(content.lessonId, asJson(content.videoSource));
  await Promise.all(content.files.map((f) => repo.setFileSourceUrl(f.kajabi_id, f.source_url)));
}

/**
 * Mirrors the lesson's downloads: upsert what the editor returned (restoring any that had been
 * marked deleted), soft-delete what it no longer returns. Only called after a complete response.
 */
async function syncFiles(supabase: SupabaseClient, content: LessonContent, stamp: string): Promise<void> {
  const repo = coursesOf(supabase);

  await repo.upsertFiles(
    content.files.map((f) => ({
      kajabi_id: f.kajabi_id,
      lesson_kajabi_id: content.lessonId,
      filename: f.filename,
      source_url: f.source_url,
      raw_payload: asJson(f.raw_payload),
      fetched_at: stamp,
      deleted_at: null,
    }))
  );

  const keep = new Set(content.files.map((f) => f.kajabi_id));
  const gone = (await repo.liveFileIds(content.lessonId)).filter((id) => !keep.has(id));
  await repo.softDeleteFiles(gone, stamp);
}

export type { LessonTarget };

/**
 * The lessons to capture: live Bronze lessons of a course (or one lesson). Drafts are skipped
 * unless asked for, since Silver never shows them and some are unfinished.
 */
export async function selectLessons(
  supabase: SupabaseClient,
  scope: { courseId: string } | { lessonId: string },
  { includeDrafts = false }: { includeDrafts?: boolean } = {}
): Promise<LessonTarget[]> {
  return coursesOf(supabase).lessonTargets(scope, { includeDrafts });
}
