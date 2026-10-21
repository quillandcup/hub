import type { SupabaseClient } from "@supabase/supabase-js";
import { visibleLessonIds } from "@/lib/courses/visible";
import { fetchAllBronzeRows } from "@/lib/supabase/bronze-pagination";
import { inBatches } from "@/lib/courses/db";
import type { MuxAssetStatus, MuxVideoQuality } from "@/lib/mux";

/**
 * Course videos -> Mux (docs/COURSES.md, step D). Takes the video source the Kajabi content step
 * recorded on each Bronze lesson (Kajabi's media id and a presigned download link that expires),
 * has Mux fetch it straight from that link, and records the result as a Local `videos` row.
 * Step C then links each lesson to its video.
 *
 * Videos of lessons that are visible in the Hub (open or "Coming soon") are uploaded by the normal
 * upload. A video used only by Kajabi drafts is planned too (`draft`) so staff can preview those
 * lessons, but it is never uploaded by the normal upload: every upload is billed, and drafts are
 * work in progress (some are leftovers), so uploading them is a separate, deliberate action
 * (`drafts: true`). A video already uploaded is never uploaded again, and a run only ever does new
 * work, so it is safe to repeat. An upload is a button press, not part of the automatic sync, for
 * the same cost reason.
 *
 * Writes need a service-role client (`videos` is service-role only).
 */

/** What the media step needs from Mux, so tests can fake it. */
export interface CourseMuxApi {
  createAsset(opts: { url: string; videoId: string; quality: MuxVideoQuality }): Promise<{ assetId: string }>;
  getAsset(assetId: string): Promise<MuxAssetStatus>;
}

/** Lessons use Mux's `plus` tier: slides with small text are what `basic` softens (docs/COURSES.md). */
export const COURSE_VIDEO_QUALITY: MuxVideoQuality = "plus";

/** A link needs at least this long left to be worth handing to Mux. */
const LINK_MARGIN_MS = 5 * 60 * 1000;

export type VideoPlanState =
  /** Already in Mux (preparing or ready): nothing to do. */
  | "uploaded"
  /** Has a usable link: will be uploaded. */
  | "ready_to_upload"
  /** Needs uploading but the link has expired: run the Kajabi content step again to mint a new one. */
  | "link_expired"
  /** Needs uploading but the content step recorded no link. */
  | "no_link";

export interface PlannedVideo {
  mediaId: string;
  /** Only Kajabi drafts use this video: it is for staff previews and is uploaded on request, never with the rest. */
  draft: boolean;
  lessonTitles: string[];
  durationSeconds: number | null;
  state: VideoPlanState;
  downloadUrl: string | null;
  /** An existing `videos` row that failed before (errored, or never got an asset), to retry. */
  retryVideoId: string | null;
  videoStatus: "preparing" | "ready" | "errored" | null;
}

interface VideoRow {
  id: string;
  source_key: string;
  status: "preparing" | "ready" | "errored";
  mux_asset_id: string | null;
}

/** The videos of a course's lessons, drafts' included and marked, and what each needs. Reads only. */
export async function planCourseVideos(supabase: SupabaseClient, courseKajabiId: string, now: Date): Promise<PlannedVideo[]> {
  const [modules, lessons] = await Promise.all([
    fetchAllBronzeRows(supabase, "kajabi_course_modules", "kajabi_id, parent_kajabi_id, position, title, publishing_option", (q) =>
      q.eq("course_kajabi_id", courseKajabiId).is("deleted_at", null)
    ),
    fetchAllBronzeRows(
      supabase,
      "kajabi_course_lessons",
      "kajabi_id, module_kajabi_id, position, title, publishing_option, video_media_id, video_source, video_duration_seconds",
      (q) => q.eq("course_kajabi_id", courseKajabiId).is("deleted_at", null)
    ),
  ]);

  // Same visibility rule as members get: a video is a draft's when no visible lesson uses it.
  const visibleIds = visibleLessonIds(modules, lessons);

  const withVideo = lessons.filter((l) => l.video_media_id);
  const mediaIds = Array.from(new Set(withVideo.map((l) => l.video_media_id as string)));

  const videos = new Map<string, VideoRow>();
  for (const batch of inBatches(mediaIds)) {
    const { data, error } = await supabase
      .from("videos")
      .select("id, source_key, status, mux_asset_id")
      .eq("source_kind", "kajabi")
      .in("source_key", batch);
    if (error) throw new Error(`videos read failed: ${error.message}`);
    for (const v of data ?? []) videos.set(v.source_key, v as VideoRow);
  }

  return mediaIds.map((mediaId) => {
    const group = withVideo.filter((l) => l.video_media_id === mediaId);
    const source = group.map((l) => l.video_source).find(Boolean) as { download_url?: string | null; download_url_expires_at?: string | null } | undefined;
    const row = videos.get(mediaId);
    const inMux = !!row && !!row.mux_asset_id && row.status !== "errored";
    const expiresAt = source?.download_url_expires_at ? new Date(source.download_url_expires_at).getTime() : null;

    let state: VideoPlanState;
    if (inMux) state = "uploaded";
    else if (!source?.download_url) state = "no_link";
    else if (expiresAt !== null && expiresAt - now.getTime() < LINK_MARGIN_MS) state = "link_expired";
    else state = "ready_to_upload";

    return {
      mediaId,
      draft: group.every((l) => !visibleIds.has(l.kajabi_id)),
      lessonTitles: group.map((l) => l.title),
      durationSeconds: group.map((l) => l.video_duration_seconds).find((d) => typeof d === "number") ?? null,
      state,
      downloadUrl: source?.download_url ?? null,
      retryVideoId: row && !inMux ? row.id : null,
      videoStatus: row?.status ?? null,
    };
  });
}

/**
 * A cheap change check that downloads nothing: size, ETag and Last-Modified from a one-byte ranged
 * GET (the link is signed for GET only, so HEAD is refused). Stored on the video so a later run can
 * tell whether the same media id now points at different bytes.
 */
export async function fingerprintSource(url: string): Promise<string> {
  const response = await fetch(url, { headers: { Range: "bytes=0-0" } });
  if (!response.ok && response.status !== 206) throw new Error(`source answered ${response.status}`);
  const total = response.headers.get("content-range")?.split("/")[1] ?? response.headers.get("content-length") ?? "";
  return [total, response.headers.get("etag") ?? "", response.headers.get("last-modified") ?? ""].join("|");
}

export interface UploadResult {
  uploaded: { mediaId: string; videoId: string; assetId: string }[];
  alreadyInMux: number;
  /** Needs a fresh link: run the Kajabi content step again. */
  needsNewLink: { mediaId: string; lessonTitles: string[]; reason: "expired" | "missing" }[];
  failed: { mediaId: string; lessonTitles: string[]; error: string }[];
}

export async function uploadCourseVideos(
  supabase: SupabaseClient,
  api: CourseMuxApi,
  courseKajabiId: string,
  now: Date,
  fingerprint: (url: string) => Promise<string> = fingerprintSource,
  /** `drafts` uploads the videos only drafts use, and only those: the normal upload never does. */
  options: { drafts?: boolean } = {}
): Promise<UploadResult> {
  const plan = await planCourseVideos(supabase, courseKajabiId, now);
  const result: UploadResult = { uploaded: [], alreadyInMux: 0, needsNewLink: [], failed: [] };

  for (const item of plan) {
    if (item.draft !== (options.drafts ?? false)) continue;
    if (item.state === "uploaded") {
      result.alreadyInMux++;
      continue;
    }
    if (item.state === "no_link" || item.state === "link_expired") {
      result.needsNewLink.push({ mediaId: item.mediaId, lessonTitles: item.lessonTitles, reason: item.state === "link_expired" ? "expired" : "missing" });
      continue;
    }

    let videoId = item.retryVideoId;
    try {
      const sourceFingerprint = await fingerprint(item.downloadUrl!).catch(() => null);
      if (videoId) {
        const { error } = await supabase.from("videos").update({ status: "preparing", source_fingerprint: sourceFingerprint }).eq("id", videoId);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await supabase
          .from("videos")
          .insert({
            source_kind: "kajabi",
            source_key: item.mediaId,
            status: "preparing",
            quality: COURSE_VIDEO_QUALITY,
            source_fingerprint: sourceFingerprint,
            duration_seconds: item.durationSeconds,
            has_burned_in_captions: true,
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        videoId = data.id;
      }

      const { assetId } = await api.createAsset({ url: item.downloadUrl!, videoId: videoId!, quality: COURSE_VIDEO_QUALITY });
      // Saved straight away: the webhook looks the video up by this id.
      const { error: saveError } = await supabase.from("videos").update({ mux_asset_id: assetId }).eq("id", videoId!);
      if (saveError) throw new Error(`couldn't save the Mux asset id ${assetId}: ${saveError.message}`);
      result.uploaded.push({ mediaId: item.mediaId, videoId: videoId!, assetId });
    } catch (error: any) {
      // Left errored so the next run retries it; a row that never got an asset id counts as failed too.
      if (videoId) await supabase.from("videos").update({ status: "errored" }).eq("id", videoId);
      result.failed.push({ mediaId: item.mediaId, lessonTitles: item.lessonTitles, error: error?.message ?? "upload failed" });
    }
  }
  return result;
}

export interface RefreshResult {
  checked: number;
  ready: number;
  errored: number;
  stillPreparing: number;
}

/** Brings videos still "preparing" up to date from Mux, for when the webhook hasn't (or can't) deliver. */
export async function refreshVideoStatuses(supabase: SupabaseClient, api: CourseMuxApi): Promise<RefreshResult> {
  const { data, error } = await supabase.from("videos").select("id, mux_asset_id").eq("status", "preparing").not("mux_asset_id", "is", null);
  if (error) throw new Error(`videos read failed: ${error.message}`);

  const result: RefreshResult = { checked: 0, ready: 0, errored: 0, stillPreparing: 0 };
  for (const video of data ?? []) {
    result.checked++;
    const status = await api.getAsset(video.mux_asset_id);
    if (status.status === "preparing") {
      result.stillPreparing++;
      continue;
    }
    const { error: updateError } = await supabase
      .from("videos")
      .update({
        status: status.status,
        ...(status.playbackId ? { mux_playback_id: status.playbackId } : {}),
        ...(status.durationSeconds !== undefined ? { duration_seconds: status.durationSeconds } : {}),
      })
      .eq("id", video.id);
    if (updateError) throw new Error(`videos update failed: ${updateError.message}`);
    if (status.status === "ready") result.ready++;
    else result.errored++;
  }
  return result;
}
