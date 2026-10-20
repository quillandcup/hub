import { NextRequest, NextResponse } from "next/server";
import { getCoursesCaller } from "@/lib/courses/caller";
import { canOpenLessons, loadMemberCourseAccess } from "@/lib/courses/member";
import { parseWatchBatch } from "@/lib/courses/watch";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Saves what a member watched of a lesson video: the continuous stretches the player closed
 * (`video_watch_segments`, append-only) and where the playhead was (`lesson_progress`, for resume).
 * A route rather than a server action because the player also sends on page leave, with
 * `fetch(..., { keepalive: true })`. Checks for itself like the mark-complete action: the signed-in
 * member with courses on, access to the lesson's course, an open lesson, and a video that really
 * belongs to that lesson. Nothing is written in sudo (an admin previewing as a member leaves no
 * viewing history), and progress isn't tracked for lessons members can't open yet.
 *
 * Written as the member, so RLS only lets it touch their own rows. Completion is never changed here.
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
  const { data: lesson } = await service.from("course_lessons").select("course_id, state, video_id").eq("id", batch.lessonId).maybeSingle();
  if (!lesson || lesson.state !== "open" || !lesson.video_id) return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  const access = await loadMemberCourseAccess(service, caller.scope, lesson.course_id);
  if (!canOpenLessons(access)) return NextResponse.json({ error: "No access to this course" }, { status: 403 });

  const supabase = await createClient();
  const memberId = caller.identity.memberId;

  if (batch.segments.length > 0) {
    const { error } = await supabase.from("video_watch_segments").insert(
      batch.segments.map((s) => ({
        member_id: memberId,
        video_id: lesson.video_id,
        session_id: batch.sessionId,
        start_seconds: s.start,
        end_seconds: s.end,
        playback_rate: s.rate,
        captions_language: s.captions,
        visible: s.visible,
      }))
    );
    if (error) {
      console.error("video_watch_segments insert failed:", error.message);
      return NextResponse.json({ error: "Couldn't save your progress" }, { status: 500 });
    }
  }

  if (batch.position !== null) {
    // Only the position: an upsert writes the columns it is given, so completed_at is left alone.
    const { error } = await supabase
      .from("lesson_progress")
      .upsert({ member_id: memberId, lesson_id: batch.lessonId, last_position_seconds: batch.position }, { onConflict: "member_id,lesson_id" });
    if (error) {
      console.error("lesson_progress position upsert failed:", error.message);
      return NextResponse.json({ error: "Couldn't save your progress" }, { status: 500 });
    }
  }

  return NextResponse.json({ saved: batch.segments.length });
}
