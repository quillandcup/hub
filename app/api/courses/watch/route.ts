import { NextRequest, NextResponse } from "next/server";
import { getCoursesCaller } from "@/lib/courses/caller";
import { canOpenLessons, loadMemberCourseAccess } from "@/lib/courses/member";
import { recordLessonWatched } from "@/lib/courses/activity";
import { parseWatchBatch } from "@/lib/courses/watch";
import { createRepos } from "@/lib/data/repos";
import { userAgentForStorage } from "@/lib/device-label";
import { deviceForStorage } from "@/lib/device";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Saves what a member watched of a lesson video: the continuous stretches the player closed
 * (`video_watch_segments`, append-only) and where the playhead was (`lesson_progress`, for resume).
 * A route rather than a server action because the player also sends on page leave, with
 * `fetch(..., { keepalive: true })`. Checks for itself like the mark-complete action: the signed-in
 * member with courses on, access to the lesson's course, an open lesson, and a video that really
 * belongs to that lesson. Nothing is written in sudo (an admin previewing as a member leaves no
 * viewing history). Lessons members can't open yet are refused, except for staff acting as
 * themselves (the lesson page only sends for a preview when the staff member turned recording on).
 *
 * Written as the member, so RLS only lets it touch their own rows. Completion is never changed here.
 * `viewed` records that the player appeared for this session (a marker row beside the stretches: the
 * play rate's denominator, and the device a view came from).
 * Safe to resend: each segment has a client-made id (unique per member), so one that already arrived
 * is skipped, and `saved` counts only the new ones.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const batch = parseWatchBatch(body);
  if (!batch) return NextResponse.json({ error: "Invalid watch data" }, { status: 400 });

  const caller = await getCoursesCaller();
  if (!caller) return NextResponse.json({ error: "Not available" }, { status: 401 });
  if (caller.identity.isSudo) return NextResponse.json({ saved: 0, reason: "sudo" });

  const service = createServiceRoleClient();
  const lesson = await createRepos(service).courses.lessonById(batch.lessonId);
  // Members only get open lessons; staff acting as themselves can also record a preview of an unreleased one (their own rows).
  const openToCaller = lesson?.state === "open" || caller.scope.isAdminActing;
  if (!lesson || !openToCaller || !lesson.video_id) return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  const access = await loadMemberCourseAccess(createRepos(service), caller.scope, lesson.course_id);
  if (!canOpenLessons(access)) return NextResponse.json({ error: "No access to this course" }, { status: 403 });

  const supabase = await createClient();
  const progress = createRepos(supabase).courseProgress;
  const memberId = caller.identity.memberId;
  const videoId = lesson.video_id; // narrowed above; kept for the closures below

  // The player appeared: one "viewed" marker per player session (its client id is the session id, so a resend is ignored).
  if (batch.viewed) {
    try {
      await progress.saveSegments([
        {
          client_segment_id: batch.sessionId,
          member_id: memberId,
          video_id: videoId,
          session_id: batch.sessionId,
          kind: "viewed",
          start_seconds: 0,
          end_seconds: 0,
          user_agent: userAgentForStorage(request.headers.get("user-agent")),
          device: deviceForStorage(request.headers.get("user-agent")),
        },
      ]);
    } catch (error) {
      console.error("video_watch_segments viewed marker failed:", error instanceof Error ? error.message : error);
      return NextResponse.json({ error: "Couldn't save your progress" }, { status: 500 });
    }
  }

  // Each segment carries the player's own id, so a resend of a save that already arrived is ignored (stored once).
  let saved = 0;
  if (batch.segments.length > 0) {
    try {
      saved = await progress.saveSegments(
        batch.segments.map((s) => ({
          client_segment_id: s.id,
          member_id: memberId,
          video_id: videoId,
          session_id: batch.sessionId,
          start_seconds: s.start,
          end_seconds: s.end,
          playback_rate: s.rate,
          captions_language: s.captions,
          visible: s.visible,
        }))
      );
    } catch (error) {
      console.error("video_watch_segments insert failed:", error instanceof Error ? error.message : error);
      return NextResponse.json({ error: "Couldn't save your progress" }, { status: 500 });
    }
  }

  // New stretches may have tipped today's watching over the line that counts as having watched the
  // lesson: log it for the Activity Log and engagement. Members' open lessons only (not a staff preview).
  if (saved > 0 && lesson.state === "open") {
    await recordLessonWatched(createRepos(supabase), {
      memberId,
      lessonId: batch.lessonId,
      courseId: lesson.course_id,
      lessonTitle: lesson.title,
      videoId: lesson.video_id,
      lessonSeconds: lesson.duration_seconds === null ? null : Number(lesson.duration_seconds),
    });
  }

  if (batch.position !== null) {
    // Only the position: completed_at is left alone.
    try {
      await progress.savePosition(memberId, batch.lessonId, batch.position);
    } catch (error) {
      console.error("lesson_progress position upsert failed:", error instanceof Error ? error.message : error);
      return NextResponse.json({ error: "Couldn't save your progress" }, { status: 500 });
    }
  }

  return NextResponse.json({ saved });
}
