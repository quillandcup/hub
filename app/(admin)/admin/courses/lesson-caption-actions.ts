"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { captionLanguageName, isCaptionLanguage, parseCaptionUpload } from "@/lib/courses/captions";
import { COURSE_FILES_BUCKET } from "@/lib/courses/file-format";
import { createRepos } from "@/lib/data/repos";
import { isId, isUuid } from "@/lib/ids";
import { addTextTrack, createMuxClient, generateTextTrack, removeTextTrack } from "@/lib/mux";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Captions and subtitles for the video of a Hub-owned lesson. A caption file the admin uploads is kept in the private
 * `course-files` bucket (the source of truth, so the track can be attached again) and attached to the Mux asset, which
 * reads it from a short-lived link; the player then offers it from the stream. Mux can also write subtitles from the audio.
 * `video_text_tracks` is written with the service role, after the admin check, as `videos` is.
 */

type Auth = Extract<Awaited<ReturnType<typeof requireAdminAction>>, { ok: true }>;
export type CaptionResult = { error?: string; id?: string };

const NOT_EDITABLE = "That course can't be edited here: it isn't in the Hub, or it's imported from Kajabi.";
/** How long Mux has to fetch the file we hand it. */
const LINK_SECONDS = 600;
const CONTENT_TYPES = { vtt: "text/vtt", srt: "application/x-subrip" } as const;

function revalidate(courseId: string, lessonId: string) {
  revalidatePath(`/admin/courses/${courseId}/lessons/${lessonId}`);
  revalidatePath("/courses", "layout");
}

/** The lesson and its video, when the lesson is a Hub-owned lesson of this course whose video is ready on Mux. */
async function readyVideo(auth: Auth, courseId: string, lessonId: string) {
  if (!isId(courseId, "crs") || !isId(lessonId, "les")) return { error: NOT_EDITABLE };
  const lesson = await createRepos(auth.supabase).courses.lessonById(lessonId);
  if (!lesson || lesson.course_id !== courseId || lesson.source !== "hub") return { error: NOT_EDITABLE };
  if (!lesson.video_id) return { error: "This lesson has no video." };
  const [video] = await createRepos(createServiceRoleClient()).courses.videosByIds([lesson.video_id]);
  if (!video || video.status !== "ready" || !video.mux_asset_id) return { error: "The video isn't ready yet." };
  return { video: { id: video.id, assetId: video.mux_asset_id } };
}

/** Takes a track off Mux, out of the bucket and out of the table. Best effort on the first two: what is left behind is only unreferenced. */
async function dropTrack(track: { id: string; mux_track_id: string | null; storage_path: string | null }, assetId: string) {
  const service = createServiceRoleClient();
  if (track.mux_track_id) {
    try {
      await removeTextTrack(createMuxClient(), assetId, track.mux_track_id);
    } catch (error) {
      console.error("lesson captions: couldn't take a track off Mux:", error instanceof Error ? error.message : error);
    }
  }
  if (track.storage_path) await service.storage.from(COURSE_FILES_BUCKET).remove([track.storage_path]).catch(() => undefined);
  await createRepos(service).courses.deleteTextTrack(track.id);
}

async function addImpl(auth: Auth, courseId: string, lessonId: string, input: { language: string; label: string; text: string }): Promise<CaptionResult> {
  const found = await readyVideo(auth, courseId, lessonId);
  if (!found.video) return { error: found.error };
  const parsed = parseCaptionUpload(input);
  if (!parsed.ok) return { error: parsed.error };

  const service = createServiceRoleClient();
  const courses = createRepos(service).courses;
  const bucket = service.storage.from(COURSE_FILES_BUCKET);
  const path = `video-tracks/${found.video.id}/${randomUUID()}.${parsed.format}`;
  let muxTrack: string | null = null;
  try {
    const existing = await courses.textTracksOf(found.video.id);
    if (existing.some((t) => t.label.toLowerCase() === parsed.label.toLowerCase())) return { error: `There is already a track called “${parsed.label}”. Remove it first, or use another name.` };

    const { error: uploadError } = await bucket.upload(path, new Blob([parsed.text], { type: CONTENT_TYPES[parsed.format] }), { contentType: CONTENT_TYPES[parsed.format] });
    if (uploadError) throw new Error(uploadError.message);
    const { data: link, error: linkError } = await bucket.createSignedUrl(path, LINK_SECONDS);
    if (linkError || !link) throw new Error(linkError?.message ?? "no signed link");

    muxTrack = (await addTextTrack(createMuxClient(), found.video.assetId, { url: link.signedUrl, language: parsed.language, name: parsed.label, closedCaptions: true })).trackId;
    await courses.addTextTrack({ video_id: found.video.id, kind: "captions", language: parsed.language, label: parsed.label, source: "manual", storage_path: path, mux_track_id: muxTrack });

    // A file from a person replaces the automatic one in the same language.
    for (const auto of existing.filter((t) => t.source === "mux_auto" && t.language === parsed.language)) await dropTrack(auto, found.video.assetId);
  } catch (error) {
    console.error("lesson captions: couldn't add a track:", error instanceof Error ? error.message : error);
    // Nothing points at what was made: don't leave it behind.
    await bucket.remove([path]).catch(() => undefined);
    if (muxTrack) await removeTextTrack(createMuxClient(), found.video.assetId, muxTrack).catch(() => undefined);
    return { error: "Couldn't add the captions." };
  }
  revalidate(courseId, lessonId);
  return { id: lessonId };
}

async function generateImpl(auth: Auth, courseId: string, lessonId: string, language: string): Promise<CaptionResult> {
  const found = await readyVideo(auth, courseId, lessonId);
  if (!found.video) return { error: found.error };
  if (!isCaptionLanguage(language)) return { error: "Choose a language." };

  const courses = createRepos(createServiceRoleClient()).courses;
  try {
    if ((await courses.textTracksOf(found.video.id)).some((t) => t.language === language)) return { error: `${captionLanguageName(language)} already has captions. Remove them first to make new ones.` };
    const label = `${captionLanguageName(language)} (automatic)`;
    const { trackId } = await generateTextTrack(createMuxClient(), found.video.assetId, { language, name: label });
    try {
      await courses.addTextTrack({ video_id: found.video.id, kind: "subtitles", language, label, source: "mux_auto", mux_track_id: trackId });
    } catch (error) {
      await removeTextTrack(createMuxClient(), found.video.assetId, trackId).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    console.error("lesson captions: couldn't generate captions:", error instanceof Error ? error.message : error);
    return { error: "Couldn't make the captions." };
  }
  revalidate(courseId, lessonId);
  return { id: lessonId };
}

async function removeImpl(auth: Auth, courseId: string, lessonId: string, trackId: string): Promise<CaptionResult> {
  const found = await readyVideo(auth, courseId, lessonId);
  if (!found.video) return { error: found.error };
  if (!isUuid(trackId)) return { error: "Not found." };
  try {
    const track = await createRepos(createServiceRoleClient()).courses.textTrack(found.video.id, trackId);
    if (!track) return { error: "Not found." };
    await dropTrack(track, found.video.assetId);
  } catch (error) {
    console.error("lesson captions: couldn't remove a track:", error instanceof Error ? error.message : error);
    return { error: "Couldn't remove the captions." };
  }
  revalidate(courseId, lessonId);
  return { id: trackId };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
/** Adds a WebVTT or SubRip file as captions on the lesson's video. */
export async function addLessonCaptions(courseId: string, lessonId: string, input: { language: string; label: string; text: string }): Promise<CaptionResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("course_lesson_captions_added", () => addImpl(auth, courseId, lessonId, input));
}

/** Has Mux write subtitles for the lesson's video from its audio. */
export async function generateLessonCaptions(courseId: string, lessonId: string, language: string): Promise<CaptionResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("course_lesson_captions_generated", () => generateImpl(auth, courseId, lessonId, language));
}

/** Removes a caption track from the lesson's video. */
export async function removeLessonCaptions(courseId: string, lessonId: string, trackId: string): Promise<CaptionResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("course_lesson_captions_removed", () => removeImpl(auth, courseId, lessonId, trackId));
}
