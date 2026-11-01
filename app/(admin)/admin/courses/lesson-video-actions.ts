"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { APP_URL } from "@/lib/config";
import { COURSE_VIDEO_QUALITY } from "@/lib/courses/media";
import { createRepos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";
import { createDirectUpload, createMuxClient, getAssetStatus, getUploadStatus } from "@/lib/mux";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * The video of a Hub-owned lesson, uploaded from the browser straight to Mux (a direct upload: the file
 * never passes through our server). Starting an upload makes the video's row and points the lesson at it, so
 * the page shows "being prepared" at once; Mux's webhook (or `refreshLessonVideo`, where there is no webhook)
 * fills in the rest. `videos` is written with the service role, after the admin check, as the Kajabi step does.
 */

type Auth = Extract<Awaited<ReturnType<typeof requireAdminAction>>, { ok: true }>;
export type VideoResult = { error?: string; url?: string };
export type VideoRefreshResult = { error?: string; status?: "none" | "waiting" | "preparing" | "ready" | "errored" };
export type VideoRemoveResult = { error?: string; id?: string };

const NOT_EDITABLE = "That course can't be edited here: it isn't in the Hub, or it's imported from Kajabi.";

function revalidate(courseId: string, lessonId: string) {
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath(`/admin/courses/${courseId}/lessons/${lessonId}`);
  revalidatePath("/courses", "layout");
}

/** The lesson, when it is a Hub-owned lesson of this course. */
async function hubLesson(auth: Auth, courseId: string, lessonId: string) {
  if (!isId(courseId, "crs") || !isId(lessonId, "les")) return null;
  const lesson = await createRepos(auth.supabase).courses.lessonById(lessonId);
  return lesson && lesson.course_id === courseId && lesson.source === "hub" ? lesson : null;
}

async function startUploadImpl(auth: Auth, courseId: string, lessonId: string): Promise<VideoResult> {
  const lesson = await hubLesson(auth, courseId, lessonId);
  if (!lesson) return { error: NOT_EDITABLE };
  try {
    // The address the browser sends the file to must accept a request from the page it is on.
    const { uploadId, url } = await createDirectUpload(createMuxClient(), { corsOrigin: new URL(APP_URL).origin, quality: COURSE_VIDEO_QUALITY });
    const videoId = await createRepos(createServiceRoleClient()).courses.createVideo({ source_kind: "upload", source_key: uploadId, quality: COURSE_VIDEO_QUALITY });
    if (!(await createRepos(auth.supabase).courses.setLessonVideo({ id: lessonId, courseId }, videoId))) return { error: NOT_EDITABLE };
    revalidate(courseId, lessonId);
    return { url };
  } catch (error) {
    console.error("lesson video: couldn't start an upload:", error instanceof Error ? error.message : error);
    return { error: "Couldn't start the upload." };
  }
}

async function refreshImpl(auth: Auth, courseId: string, lessonId: string): Promise<VideoRefreshResult> {
  const lesson = await hubLesson(auth, courseId, lessonId);
  if (!lesson) return { error: NOT_EDITABLE };
  if (!lesson.video_id) return { status: "none" };

  try {
    const courses = createRepos(createServiceRoleClient()).courses;
    const [video] = await courses.videosByIds([lesson.video_id]);
    if (!video) return { status: "none" };
    const mux = createMuxClient();

    let assetId = video.mux_asset_id;
    if (!assetId) {
      // The file hasn't been seen as complete yet: ask Mux whether it has (what the webhook would have told us).
      if (video.source_kind !== "upload") return { status: "preparing" };
      const upload = await getUploadStatus(mux, video.source_key);
      if (upload.status === "waiting") return { status: "waiting" };
      if (upload.status === "failed" || !upload.assetId) {
        await courses.updateVideo(video.id, { status: "errored" });
        revalidate(courseId, lessonId);
        return { status: "errored" };
      }
      assetId = upload.assetId;
      await courses.updateVideo(video.id, { mux_asset_id: assetId });
    }

    const asset = await getAssetStatus(mux, assetId);
    await courses.updateVideosByAsset(assetId, {
      status: asset.status,
      ...(asset.playbackId ? { mux_playback_id: asset.playbackId } : {}),
      ...(asset.durationSeconds !== undefined ? { duration_seconds: asset.durationSeconds } : {}),
    });
    if (asset.status === "ready") await courses.syncLessonDurations(assetId);
    revalidate(courseId, lessonId);
    return { status: asset.status };
  } catch (error) {
    console.error("lesson video: couldn't check on the video:", error instanceof Error ? error.message : error);
    return { error: "Couldn't check on the video." };
  }
}

async function removeImpl(auth: Auth, courseId: string, lessonId: string): Promise<VideoRemoveResult> {
  if (!(await hubLesson(auth, courseId, lessonId))) return { error: NOT_EDITABLE };
  try {
    if (!(await createRepos(auth.supabase).courses.setLessonVideo({ id: lessonId, courseId }, null))) return { error: NOT_EDITABLE };
  } catch (error) {
    console.error("lesson video: couldn't take the video off:", error instanceof Error ? error.message : error);
    return { error: "Couldn't take the video off." };
  }
  revalidate(courseId, lessonId);
  return { id: lessonId };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
/** Makes a one-use upload address for the lesson's video and points the lesson at the video it will become. */
export async function startLessonVideoUpload(courseId: string, lessonId: string): Promise<VideoResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("course_lesson_video_upload_started", () => startUploadImpl(auth, courseId, lessonId));
}

/** Catches the lesson's video up with Mux: whether the upload finished and whether the video is ready. */
export async function refreshLessonVideo(courseId: string, lessonId: string): Promise<VideoRefreshResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("course_lesson_video_refreshed", () => refreshImpl(auth, courseId, lessonId));
}

/** Takes the video off the lesson. The video itself stays in Mux (docs/TODO.md). */
export async function removeLessonVideo(courseId: string, lessonId: string): Promise<VideoRemoveResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("course_lesson_video_removed", () => removeImpl(auth, courseId, lessonId));
}
