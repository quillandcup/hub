import { createRepos } from "@/lib/data/repos";
import type { DeviceInfo } from "@/lib/device-label";
import { getMemberDisplayName } from "@/lib/member-display-name";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildOutline, type OutlineLesson, type OutlineModule } from "@/lib/courses/outline";
import { computePlaySessions, computeVideoWatchStats, type PlaySession, type VideoWatchStats, type ViewMarker, type WatchSegment } from "@/lib/courses/watch-stats";

/**
 * What the staff watch-stats pages read: each lesson's video, and how it was watched. Takes a
 * service-role client (the pages sit behind `requireAdminPage()`), so it reads every member's
 * segments; nothing here is shown to members.
 */

/** Where a visit came from: the access log's latest located event before it (see access_locations_at). */
export interface SessionLocation {
  /** "Muncie, IN, US" (whatever parts are known), or null when only the IP is known. */
  place: string | null;
  ip: string | null;
}

export type ViewSession = PlaySession & { memberName: string; location: SessionLocation | null };

export interface LessonWatchStats {
  lesson: OutlineLesson;
  /** Null for a lesson with no video. */
  videoId: string | null;
  /** The video's Mux playback id once it is ready, for stills of it on the stats page. */
  playbackId: string | null;
  /** Null for a lesson with no video or that nobody has viewed. */
  stats: VideoWatchStats | null;
  /** The player sessions, newest first, with who: only when asked for (`withSessions`). */
  sessions: ViewSession[];
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
  const ids = await createRepos(supabase).profiles.adminIds();
  const staff = new Set<string>();
  for (const memberId of (await createRepos(supabase).members.idsByUserId(ids)).values()) staff.add(memberId);
  return staff;
}

/**
 * The watch stats of a course's lessons (by the course's Hub id, like the admin course page),
 * or of one lesson when `lessonId` is given. Null when the course isn't in the Hub (not published).
 * Staff viewing is left out unless `includeStaff`.
 */
export async function loadCourseWatchStats(
  supabase: SupabaseClient,
  courseId: string,
  options: { includeStaff?: boolean; lessonId?: string; withSessions?: boolean; /** How many of the newest visits get a place (the page shows that many). */ sessionLimit?: number } = {}
): Promise<CourseWatchStats | null> {
  const repos = createRepos(supabase);
  const course = await repos.courses.courseById(courseId);
  if (!course) return null;

  const [moduleRows, lessonRows] = await Promise.all([repos.courses.modulesOf([course.id], { includeHidden: true }), repos.courses.lessonsOf([course.id], { includeHidden: true })]);
  const modules = moduleRows.map((m) => ({ id: m.id, parent_id: m.parent_id, title: m.title, position: m.position, state: m.state }));
  const rows = lessonRows.map((l) => ({ id: l.id, module_id: l.module_id, title: l.title, position: l.position, state: l.state, duration_seconds: l.duration_seconds, video_id: l.video_id }));
  const videoOf = new Map<string, string | null>(rows.map((l) => [l.id as string, (l.video_id as string | null) ?? null]));
  const outline = buildOutline(modules as OutlineModule[], rows as OutlineLesson[]);
  const lessons = options.lessonId ? outline.lessons.filter((l) => l.id === options.lessonId) : outline.lessons;

  const videoIds = [...new Set(lessons.map((l) => videoOf.get(l.id)).filter((v): v is string => Boolean(v)))];
  const durations = new Map<string, number | null>();
  const playbackIds = new Map<string, string | null>();
  const segmentsByVideo = new Map<string, WatchSegment[]>();
  const viewsByVideo = new Map<string, ViewMarker[]>();
  const staff = options.includeStaff ? new Set<string>() : await loadStaffMemberIds(supabase);

  const [videos, segments] = await Promise.all([repos.courses.videosByIds(videoIds), repos.courseProgress.segmentsOfVideos(videoIds)]);
  for (const v of videos) {
    durations.set(v.id, v.duration_seconds === null ? null : Number(v.duration_seconds));
    playbackIds.set(v.id, v.status === "ready" ? (v.mux_playback_id ?? null) : null);
  }
  for (const s of segments) {
    if (staff.has(s.member_id)) continue;
    if (s.kind === "viewed") {
      const views = viewsByVideo.get(s.video_id) ?? [];
      views.push({ memberId: s.member_id, sessionId: s.session_id, startedAt: s.started_at, userAgent: s.user_agent, device: (s.device as DeviceInfo | null) ?? null });
      viewsByVideo.set(s.video_id, views);
      continue;
    }
    const list = segmentsByVideo.get(s.video_id) ?? [];
    list.push({ memberId: s.member_id, sessionId: s.session_id, start: Number(s.start_seconds), end: Number(s.end_seconds), rate: Number(s.playback_rate), captions: s.captions_language, visible: s.visible, startedAt: s.started_at });
    segmentsByVideo.set(s.video_id, list);
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

  // Names for the session list (staff-only pages; the people who watched, by the name they are known by).
  const names = new Map<string, string>();
  const userIds = new Map<string, string>();
  const memberIds = [...new Set([...sessionsByVideo.values()].flatMap((list) => list.map((x) => x.memberId)))];
  for (const m of await createRepos(supabase).members.byIds(memberIds)) {
    names.set(m.id, m.name ? getMemberDisplayName({ name: m.name, display_name: m.displayName }) : "Unknown member");
    if (m.userId) userIds.set(m.id, m.userId);
  }

  // Where each shown visit came from: the member's latest located access event before it, in one call.
  const locations = new Map<string, SessionLocation>();
  if (options.withSessions) {
    const shown = [...sessionsByVideo.values()].flatMap((list) => list.slice(0, options.sessionLimit ?? 50)).filter((x) => x.startedAt && userIds.has(x.memberId));
    if (shown.length > 0) {
      const { data, error: placesError } = await supabase.rpc("access_locations_at", {
        p_user_ids: shown.map((x) => userIds.get(x.memberId)),
        p_times: shown.map((x) => x.startedAt),
      });
      if (placesError) throw new Error(`access_locations_at failed: ${placesError.message}`);
      for (const row of (data ?? []) as { idx: number; ip_address: string | null; country: string | null; region: string | null; city: string | null }[]) {
        const place = [row.city, row.region, row.country].filter(Boolean).join(", ");
        locations.set(shown[row.idx - 1].sessionId, { place: place || null, ip: row.ip_address });
      }
    }
  }

  return {
    course: { id: course.id, title: course.title, slug: course.slug },
    lessons: lessons.map((lesson) => {
      const videoId = videoOf.get(lesson.id) ?? null;
      return { lesson, videoId, playbackId: videoId ? (playbackIds.get(videoId) ?? null) : null, stats: videoId ? (statsByVideo.get(videoId) ?? null) : null, sessions: (videoId ? (sessionsByVideo.get(videoId) ?? []) : []).map((x) => ({ ...x, memberName: names.get(x.memberId) ?? "Unknown member", location: locations.get(x.sessionId) ?? null })) };
    }),
    viewers: viewerIds.size,
    watchedSeconds,
    staffExcluded: !options.includeStaff,
  };
}
