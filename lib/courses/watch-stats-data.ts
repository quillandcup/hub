import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll, inBatches } from "@/lib/courses/db";
import { buildOutline, type OutlineLesson, type OutlineModule } from "@/lib/courses/outline";
import { computePlaySessions, computeVideoWatchStats, type PlaySession, type VideoWatchStats, type ViewMarker, type WatchSegment } from "@/lib/courses/watch-stats";

/**
 * What the staff watch-stats pages read: each lesson's video, and how it was watched. Takes a
 * service-role client (the pages sit behind `requireAdminPage()`), so it reads every member's
 * segments; nothing here is shown to members.
 */

export interface LessonWatchStats {
  lesson: OutlineLesson;
  /** Null for a lesson with no video. */
  videoId: string | null;
  /** The video's Mux playback id once it is ready, for stills of it on the stats page. */
  playbackId: string | null;
  /** Null for a lesson with no video or that nobody has viewed. */
  stats: VideoWatchStats | null;
  /** The player sessions, newest first, with who: only when asked for (`withSessions`). */
  sessions: (PlaySession & { memberName: string })[];
}

export interface CourseWatchStats {
  course: { id: string; title: string; slug: string };
  lessons: LessonWatchStats[];
  /** Different members who watched any lesson of the course. */
  viewers: number;
  /** All video time played across the course, rewatches included. */
  watchedSeconds: number;
  /** Segments left out because they are staff members' own (testing and previewing). */
  staffExcluded: boolean;
}

/** Members who are staff (an admin's own member record), whose watching is test data. */
async function loadStaffMemberIds(supabase: SupabaseClient): Promise<Set<string>> {
  const { data: admins, error } = await supabase.from("user_profiles").select("id").eq("role", "admin");
  if (error) throw new Error(`user_profiles read failed: ${error.message}`);
  const ids = (admins ?? []).map((a) => a.id as string);
  const staff = new Set<string>();
  for (const batch of inBatches(ids)) {
    const { data, error: memberError } = await supabase.from("members").select("id").in("user_id", batch);
    if (memberError) throw new Error(`members read failed: ${memberError.message}`);
    for (const m of data ?? []) staff.add(m.id as string);
  }
  return staff;
}

/**
 * The watch stats of a course's lessons (by the course's Kajabi id, like the admin course page),
 * or of one lesson when `lessonId` is given. Null when the course isn't in the Hub (not published).
 * Staff viewing is left out unless `includeStaff`.
 */
export async function loadCourseWatchStats(
  supabase: SupabaseClient,
  kajabiId: string,
  options: { includeStaff?: boolean; lessonId?: string; withSessions?: boolean } = {}
): Promise<CourseWatchStats | null> {
  const { data: course, error } = await supabase.from("courses").select("id, title, slug").eq("source", "kajabi").eq("source_key", kajabiId).maybeSingle();
  if (error) throw new Error(`courses read failed: ${error.message}`);
  if (!course) return null;

  const [modules, rows] = await Promise.all([
    fetchAll(supabase, "course_modules", "id, parent_id, title, position, state", (q) => q.eq("course_id", course.id)),
    fetchAll(supabase, "course_lessons", "id, module_id, title, position, state, duration_seconds, video_id", (q) => q.eq("course_id", course.id)),
  ]);
  const videoOf = new Map<string, string | null>(rows.map((l) => [l.id as string, (l.video_id as string | null) ?? null]));
  const outline = buildOutline(modules as OutlineModule[], rows as OutlineLesson[]);
  const lessons = options.lessonId ? outline.lessons.filter((l) => l.id === options.lessonId) : outline.lessons;

  const videoIds = [...new Set(lessons.map((l) => videoOf.get(l.id)).filter((v): v is string => Boolean(v)))];
  const durations = new Map<string, number | null>();
  const playbackIds = new Map<string, string | null>();
  const segmentsByVideo = new Map<string, WatchSegment[]>();
  const viewsByVideo = new Map<string, ViewMarker[]>();
  const staff = options.includeStaff ? new Set<string>() : await loadStaffMemberIds(supabase);

  for (const batch of inBatches(videoIds)) {
    const [videos, segments] = await Promise.all([
      fetchAll(supabase, "videos", "id, duration_seconds, mux_playback_id, status", (q) => q.in("id", batch)),
      fetchAll(supabase, "video_watch_segments", "member_id, session_id, video_id, kind, start_seconds, end_seconds, playback_rate, captions_language, visible, user_agent, started_at", (q) => q.in("video_id", batch)),
    ]);
    for (const v of videos) {
      durations.set(v.id, v.duration_seconds === null ? null : Number(v.duration_seconds));
      playbackIds.set(v.id, v.status === "ready" ? (v.mux_playback_id ?? null) : null);
    }
    for (const s of segments) {
      if (staff.has(s.member_id)) continue;
      if (s.kind === "viewed") {
        const views = viewsByVideo.get(s.video_id) ?? [];
        views.push({ memberId: s.member_id, sessionId: s.session_id, startedAt: s.started_at, userAgent: s.user_agent });
        viewsByVideo.set(s.video_id, views);
        continue;
      }
      const list = segmentsByVideo.get(s.video_id) ?? [];
      list.push({ memberId: s.member_id, sessionId: s.session_id, start: Number(s.start_seconds), end: Number(s.end_seconds), rate: Number(s.playback_rate), captions: s.captions_language, visible: s.visible, startedAt: s.started_at });
      segmentsByVideo.set(s.video_id, list);
    }
  }

  const statsByVideo = new Map<string, VideoWatchStats>();
  const sessionsByVideo = new Map<string, PlaySession[]>();
  const viewerIds = new Set<string>();
  let watchedSeconds = 0;
  for (const videoId of videoIds) {
    const segments = segmentsByVideo.get(videoId) ?? [];
    const views = viewsByVideo.get(videoId) ?? [];
    if (segments.length === 0 && views.length === 0) continue;
    const stats = computeVideoWatchStats(segments, durations.get(videoId) ?? null, views);
    statsByVideo.set(videoId, stats);
    watchedSeconds += stats.watchedSeconds;
    for (const s of segments) viewerIds.add(s.memberId);
    if (options.withSessions) sessionsByVideo.set(videoId, computePlaySessions(segments, durations.get(videoId) ?? stats.durationSeconds, views));
  }

  // Names for the session list (staff-only pages; the people who watched, by name).
  const names = new Map<string, string>();
  const memberIds = [...new Set([...sessionsByVideo.values()].flatMap((list) => list.map((x) => x.memberId)))];
  for (const batch of inBatches(memberIds)) {
    const { data, error: namesError } = await supabase.from("members").select("id, name").in("id", batch);
    if (namesError) throw new Error(`members read failed: ${namesError.message}`);
    for (const m of data ?? []) names.set(m.id as string, (m.name as string | null) ?? "Unknown member");
  }

  return {
    course: { id: course.id, title: course.title, slug: course.slug },
    lessons: lessons.map((lesson) => {
      const videoId = videoOf.get(lesson.id) ?? null;
      return { lesson, videoId, playbackId: videoId ? (playbackIds.get(videoId) ?? null) : null, stats: videoId ? (statsByVideo.get(videoId) ?? null) : null, sessions: (videoId ? (sessionsByVideo.get(videoId) ?? []) : []).map((x) => ({ ...x, memberName: names.get(x.memberId) ?? "Unknown member" })) };
    }),
    viewers: viewerIds.size,
    watchedSeconds,
    staffExcluded: !options.includeStaff,
  };
}
