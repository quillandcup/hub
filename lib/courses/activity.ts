import type { SupabaseClient } from "@supabase/supabase-js";
import { ORG_TIMEZONE } from "@/lib/config";
import { fetchAll } from "@/lib/courses/db";
import { localDateString } from "@/lib/events-filter";

/**
 * Lesson viewing as activity-log rows (`member_activities`, source `courses`), so it shows in the
 * Activity Log and feeds engagement scoring and churn recency like every other signal. A best-effort
 * insert alongside the primary write (the watch route, mark-complete), as docs/ACTIVITY_AND_AUDIT_LOG.md
 * describes: the source of truth stays `video_watch_segments` / `lesson_progress`, and a failure here is
 * logged, never surfaced. At most one row per member, lesson and day for watching, and one per member
 * and lesson for completing, enforced by a unique index; a repeat insert is ignored.
 */

export const COURSES_ACTIVITY_SOURCE = "courses";
/**
 * Points toward the engagement score (a prickle is 10, a Slack message 1-3). They grow with the
 * lesson's length, so an hour-long webinar is worth more than a five-minute coaching video: watching
 * is a point per 5 minutes of lesson (1 to 10, a prickle at most), completing a point per 10 minutes
 * (1 to 5). Fixed when the row is written, since members can't edit their activity rows, so they
 * follow the lesson's length, not how long the member watched that day. A lesson without a length
 * gets the middle of each range.
 */
export const LESSON_WATCHED_POINTS_UNKNOWN = 3;
export const LESSON_COMPLETED_POINTS_UNKNOWN = 5;

function pointsFor(lessonSeconds: number | null, minutesPerPoint: number, max: number, unknown: number): number {
  if (lessonSeconds === null || lessonSeconds <= 0) return unknown;
  return Math.min(max, Math.max(1, Math.round(lessonSeconds / 60 / minutesPerPoint)));
}
export const lessonWatchedPoints = (lessonSeconds: number | null) => pointsFor(lessonSeconds, 5, 10, LESSON_WATCHED_POINTS_UNKNOWN);
export const lessonCompletedPoints = (lessonSeconds: number | null) => pointsFor(lessonSeconds, 10, 5, LESSON_COMPLETED_POINTS_UNKNOWN);
/** A day of watching counts once it covers this share of the video, or this much video time. */
export const WATCHED_SHARE_THRESHOLD = 0.5;
export const WATCHED_SECONDS_THRESHOLD = 5 * 60;

/** Past this window a segment can't belong to "today" in any timezone. */
const LOOKBACK_MS = 48 * 60 * 60 * 1000;
const UNIQUE_VIOLATION = "23505";

/** Whether a day's watched video time is enough to count as having watched the lesson. */
export function watchedEnough(watchedSeconds: number, lessonSeconds: number | null): boolean {
  if (watchedSeconds >= WATCHED_SECONDS_THRESHOLD) return true;
  return lessonSeconds !== null && lessonSeconds > 0 && watchedSeconds >= lessonSeconds * WATCHED_SHARE_THRESHOLD;
}

interface LessonRef {
  memberId: string;
  lessonId: string;
  courseId: string;
  lessonTitle: string;
  /** The lesson's length, null when unknown. */
  lessonSeconds: number | null;
}

async function insertOnce(supabase: SupabaseClient, row: Record<string, unknown>, label: string) {
  const { error } = await supabase.from("member_activities").insert({
    activity_category: "learning",
    actor_kind: "member",
    source: COURSES_ACTIVITY_SOURCE,
    ...row,
  });
  if (error && error.code !== UNIQUE_VIOLATION) console.error(`${label}: failed to insert member_activities row`, error);
}

/**
 * Called after new watch segments were saved: if the member has now watched enough of the lesson
 * today (their video time across the day's stretches, rewatches included), logs "Watched <lesson>".
 * `supabase` is the member's own client (RLS lets them read their segments and insert their activity).
 */
export async function recordLessonWatched(
  supabase: SupabaseClient,
  lesson: LessonRef & { videoId: string },
  now: Date = new Date()
): Promise<void> {
  try {
    const today = localDateString(now, ORG_TIMEZONE);
    const since = new Date(now.getTime() - LOOKBACK_MS).toISOString();
    const rows = await fetchAll(supabase, "video_watch_segments", "start_seconds, end_seconds, started_at", (q) =>
      q.eq("member_id", lesson.memberId).eq("video_id", lesson.videoId).eq("kind", "watched").gte("started_at", since)
    );
    const watchedSeconds = rows
      .filter((r) => localDateString(new Date(r.started_at), ORG_TIMEZONE) === today)
      .reduce((sum, r) => sum + (Number(r.end_seconds) - Number(r.start_seconds)), 0);
    if (!watchedEnough(watchedSeconds, lesson.lessonSeconds)) return;

    await insertOnce(
      supabase,
      {
        member_id: lesson.memberId,
        activity_type: "lesson_watched",
        title: `Watched ${lesson.lessonTitle}`,
        related_id: `${lesson.lessonId}:${today}`,
        engagement_value: lessonWatchedPoints(lesson.lessonSeconds),
        duration_minutes: Math.round(watchedSeconds / 60),
        occurred_at: now.toISOString(),
        data: { lesson_id: lesson.lessonId, course_id: lesson.courseId, watched_seconds: Math.round(watchedSeconds) },
      },
      "recordLessonWatched"
    );
  } catch (error) {
    console.error("recordLessonWatched failed:", error);
  }
}

/** Called when a member marks a lesson complete. Once per lesson: unmarking and marking again earns nothing more. */
export async function recordLessonCompleted(supabase: SupabaseClient, lesson: LessonRef, now: Date = new Date()): Promise<void> {
  try {
    await insertOnce(
      supabase,
      {
        member_id: lesson.memberId,
        activity_type: "lesson_completed",
        title: `Completed ${lesson.lessonTitle}`,
        related_id: lesson.lessonId,
        engagement_value: lessonCompletedPoints(lesson.lessonSeconds),
        occurred_at: now.toISOString(),
        data: { lesson_id: lesson.lessonId, course_id: lesson.courseId },
      },
      "recordLessonCompleted"
    );
  } catch (error) {
    console.error("recordLessonCompleted failed:", error);
  }
}
