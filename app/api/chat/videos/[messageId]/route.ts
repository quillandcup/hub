import { NextRequest, NextResponse } from "next/server";
import { getCoursesCaller } from "@/lib/courses/caller";
import { canOpenLessons, loadMemberCourseAccess } from "@/lib/courses/member";
import { mayWatchSharedVideo } from "@/lib/chat/video-access";
import { createRepos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";
import { createMuxClient, signPlaybackTokens } from "@/lib/mux";
import { restrictionIdForViewer } from "@/lib/mux-restriction.server";
import { resumeSeconds } from "@/lib/courses/watch";
import { hitRateLimits } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

/** A member opens a video when they press play, so a few per ten minutes covers a busy conversation. */
const LIMIT = { windowSeconds: 10 * 60, maxHits: 20 };

/** Never cached: the body is a credential. */
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Playback links for the lesson video a chat message shares, minted when the viewer presses play. Playing needs no
 * `chat_videos` flag (that decides who can share). Two checks, in this order: the viewer can read the message (the
 * share row is read as them, so row-level security applies the channel rule); then the same course checks as the
 * lesson page and `/api/courses/playback-tokens` (course access, an open lesson, a ready video), unless an admin shared
 * it open to the channel (`open_to_channel`: any reader may play it, but still only an open lesson of a published
 * course; `mayWatchSharedVideo`). A viewer who can read the message but may not watch gets 403 `no_access`, which only
 * says the video is part of a course (the message itself already told them there is a video). Everything else after sign-in is the same 404. Nothing is stored in the message, and a link only
 * works for the viewer it was minted for (`restrictionIdForViewer`).
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params;
  const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  if (!isId(messageId, "msg")) return notFound();

  const caller = await getCoursesCaller();
  if (!caller) return NextResponse.json({ error: "Not available" }, { status: 401, headers: NO_STORE });

  // Read as the viewer, so row-level security hides the share of a message they can't read.
  const share = await createRepos(await createClient()).chatVideos.shareOf(messageId);
  if (!share) return notFound();

  const repos = createRepos(createServiceRoleClient());
  if (!(await hitRateLimits(repos, [{ bucket: `chat_video_tokens:user:${caller.userId}`, ...LIMIT }]))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { ...NO_STORE, "Retry-After": String(LIMIT.windowSeconds) } });
  }

  const lesson = await repos.courses.lessonById(share.lessonId);
  if (!lesson || !lesson.video_id || !(lesson.state === "open" || caller.scope.isAdminActing)) return notFound();
  const hasCourse = canOpenLessons(await loadMemberCourseAccess(repos, caller.scope, lesson.course_id));
  if (!(await mayWatchSharedVideo(repos, share, lesson, hasCourse))) {
    return NextResponse.json({ error: "no_access" }, { status: 403, headers: NO_STORE });
  }

  const video = (await repos.courses.videosByIds([lesson.video_id]))[0];
  if (!video || video.status !== "ready" || !video.mux_playback_id) return notFound();

  const restrictionId = await restrictionIdForViewer(caller.userId, caller.identity);
  try {
    const tokens = await signPlaybackTokens(createMuxClient(), video.mux_playback_id, undefined, restrictionId);
    // Watching is recorded for members' open lessons, and not in sudo (an admin previewing leaves no viewing history).
    const record = lesson.state === "open" && !caller.identity.isSudo;
    const position = record && hasCourse ? await createRepos(await createClient()).courseProgress.lessonPosition(caller.identity.memberId, lesson.id).catch(() => null) : null;
    return NextResponse.json(
      { title: lesson.title, lessonId: lesson.id, playbackId: video.mux_playback_id, tokens, restricted: restrictionId !== null, record, resumeSeconds: resumeSeconds(position) },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("Couldn't mint Mux playback tokens for a chat video:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Couldn't create a playback link" }, { status: 502, headers: NO_STORE });
  }
}
