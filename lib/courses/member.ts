import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll, inBatches } from "@/lib/courses/db";
import { resumeSeconds } from "@/lib/courses/watch";
import {
  buildOutline,
  courseProgress,
  lessonNeighbors,
  type CourseProgress,
  type LessonNeighbors,
  type Outline,
  type OutlineLesson,
  type OutlineModule,
} from "@/lib/courses/outline";

/**
 * What the member course pages read (docs/COURSES.md, "Member experience").
 *
 * These take a service-role client on purpose: row-level security answers "does the *signed-in
 * user* have access", but sudo means the page acts for another member, and a member whose access
 * ended still sees their course (read-only). So every function here is scoped to the verified
 * `memberId` the caller passes (from getEffectiveIdentity) and decides access itself, in
 * `resolveCourseAccess`. Never pass an id taken from the request.
 */

export type CourseAccess =
  | { kind: "open"; endsAt: string | null }
  /** Staff acting as themselves: every course opens. */
  | { kind: "admin" }
  | { kind: "ended"; endsAt: string }
  /** Bought ahead of launch: access is theirs, but starts at `startsAt`. */
  | { kind: "upcoming"; startsAt: string }
  | { kind: "none" };

export interface AccessRowLike {
  starts_at: string;
  ends_at: string | null;
}

export function resolveCourseAccess(row: AccessRowLike | undefined, isAdminActing: boolean, now: Date): CourseAccess {
  if (isAdminActing) return { kind: "admin" };
  if (!row) return { kind: "none" };
  if (new Date(row.starts_at).getTime() > now.getTime()) return { kind: "upcoming", startsAt: row.starts_at };
  if (row.ends_at && new Date(row.ends_at).getTime() <= now.getTime()) return { kind: "ended", endsAt: row.ends_at };
  return { kind: "open", endsAt: row.ends_at };
}

/** Whether lessons can be opened under this access. */
export const canOpenLessons = (access: CourseAccess) => access.kind === "open" || access.kind === "admin";

export interface CourseRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  thumbnail_url?: string | null;
}

export interface MemberScope {
  memberId: string;
  /** The signed-in user is staff and not in sudo. */
  isAdminActing: boolean;
  now?: Date;
}

async function loadAccessRows(supabase: SupabaseClient, memberId: string, courseIds?: string[]) {
  const { data, error } = await supabase
    .from("course_access")
    .select("course_id, starts_at, ends_at")
    .eq("member_id", memberId)
    .in("course_id", courseIds ?? []);
  if (error) throw new Error(`course_access read failed: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.course_id as string, r as AccessRowLike]));
}

/**
 * The modules and lessons of courses. Hidden ones (Kajabi drafts) are left out unless `includeHidden`,
 * which only staff acting as themselves pass: a member's outline must never contain a draft, not even
 * its title. This is the one place the member pages read the structure, so it is the one place that decides.
 */
async function loadStructure(supabase: SupabaseClient, courseIds: string[], includeHidden = false) {
  const [modules, lessons] = await Promise.all([
    fetchAll(supabase, "course_modules", "id, course_id, parent_id, title, position, state", (q) => (includeHidden ? q : q.neq("state", "hidden")).in("course_id", courseIds)),
    fetchAll(supabase, "course_lessons", "id, course_id, module_id, title, position, state, duration_seconds, thumbnail_url, excerpt", (q) =>
      (includeHidden ? q : q.neq("state", "hidden")).in("course_id", courseIds)
    ),
  ]);
  return { modules, lessons };
}

async function loadCompleted(supabase: SupabaseClient, memberId: string, lessonIds: string[]): Promise<Set<string>> {
  const done = new Set<string>();
  for (const batch of inBatches(lessonIds)) {
    const { data, error } = await supabase
      .from("lesson_progress")
      .select("lesson_id")
      .eq("member_id", memberId)
      .not("completed_at", "is", null)
      .in("lesson_id", batch);
    if (error) throw new Error(`lesson_progress read failed: ${error.message}`);
    for (const r of data ?? []) done.add(r.lesson_id);
  }
  return done;
}

/** A member's access to one course (admins acting as themselves open everything). */
export async function loadMemberCourseAccess(supabase: SupabaseClient, scope: MemberScope, courseId: string): Promise<CourseAccess> {
  if (scope.isAdminActing) return { kind: "admin" };
  const row = (await loadAccessRows(supabase, scope.memberId, [courseId])).get(courseId);
  return resolveCourseAccess(row, false, scope.now ?? new Date());
}

export interface CourseListItem {
  course: CourseRow;
  access: CourseAccess;
  progress: CourseProgress;
}

/** The courses a member can see: the ones they have (or had) access to, or all of them for staff. Current courses first, ended ones after, each by title. */
export async function loadCourseList(supabase: SupabaseClient, scope: MemberScope): Promise<CourseListItem[]> {
  const now = scope.now ?? new Date();
  let courseIds: string[];
  let accessByCourse = new Map<string, AccessRowLike>();

  if (scope.isAdminActing) {
    courseIds = (await fetchAll(supabase, "courses", "id", (q) => q)).map((c) => c.id);
  } else {
    const { data, error } = await supabase.from("course_access").select("course_id, starts_at, ends_at").eq("member_id", scope.memberId);
    if (error) throw new Error(`course_access read failed: ${error.message}`);
    accessByCourse = new Map((data ?? []).map((r) => [r.course_id as string, r as AccessRowLike]));
    courseIds = Array.from(accessByCourse.keys());
  }
  if (courseIds.length === 0) return [];

  const courses: CourseRow[] = await fetchAll(supabase, "courses", "id, slug, title, description, thumbnail_url", (q) => q.in("id", courseIds));
  const { modules, lessons } = await loadStructure(supabase, courseIds, scope.isAdminActing);
  const completed = await loadCompleted(supabase, scope.memberId, lessons.map((l) => l.id));

  return courses
    .map((course) => {
      const access = resolveCourseAccess(accessByCourse.get(course.id), scope.isAdminActing, now);
      const outline = buildOutline(
        modules.filter((m) => m.course_id === course.id) as OutlineModule[],
        lessons.filter((l) => l.course_id === course.id) as OutlineLesson[]
      );
      return { course, access, progress: courseProgress(outline, completed) };
    })
    .filter((item) => item.access.kind !== "none")
    .sort((a, b) => Number(a.access.kind === "ended") - Number(b.access.kind === "ended") || a.course.title.localeCompare(b.course.title));
}

export interface ContinueWatching {
  course: CourseRow;
  lesson: { id: string; title: string; thumbnail_url: string | null };
  progress: CourseProgress;
  /** Seconds saved in the lesson, 0 when the card comes from "the next open lesson" rather than a half-watched one. */
  positionSeconds: number;
  href: string;
}

/**
 * What the dashboard offers to resume: the lesson the member most recently left part-way through, else the
 * next open lesson of a course they've started. Only courses whose access is open now (an ended or upcoming
 * one offers no resume), and nothing for staff acting as themselves, who would otherwise get every course.
 */
export async function loadContinueWatching(supabase: SupabaseClient, scope: MemberScope): Promise<ContinueWatching | null> {
  if (scope.isAdminActing) return null;
  const items = (await loadCourseList(supabase, scope)).filter((i) => i.access.kind === "open");
  if (items.length === 0) return null;
  const byCourse = new Map(items.map((i) => [i.course.id, i]));

  const { data: rows, error } = await supabase
    .from("lesson_progress")
    .select("lesson_id, last_position_seconds")
    .eq("member_id", scope.memberId)
    .is("completed_at", null)
    .gt("last_position_seconds", 0)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`lesson_progress read failed: ${error.message}`);
  const positions = new Map((rows ?? []).map((r) => [r.lesson_id as string, Number(r.last_position_seconds)]));

  const openLessons = async (lessonIds: string[]) => {
    if (lessonIds.length === 0) return [];
    const { data, error: lessonError } = await supabase
      .from("course_lessons")
      .select("id, course_id, title, thumbnail_url")
      .eq("state", "open")
      .in("id", lessonIds);
    if (lessonError) throw new Error(`course_lessons read failed: ${lessonError.message}`);
    return data ?? [];
  };

  const half = await openLessons(Array.from(positions.keys()));
  for (const [id, position] of positions) {
    const lesson = half.find((l) => l.id === id && byCourse.has(l.course_id));
    if (!lesson) continue;
    const item = byCourse.get(lesson.course_id)!;
    return {
      course: item.course,
      lesson: { id: lesson.id, title: lesson.title, thumbnail_url: lesson.thumbnail_url ?? null },
      progress: item.progress,
      positionSeconds: position,
      href: `/courses/${item.course.slug}/lessons/${lesson.id}`,
    };
  }

  const started = items.find((i) => i.progress.completed > 0 && !i.progress.allDone && i.progress.continueLessonId);
  if (!started) return null;
  const [next] = await openLessons([started.progress.continueLessonId!]);
  if (!next) return null;
  return {
    course: started.course,
    lesson: { id: next.id, title: next.title, thumbnail_url: next.thumbnail_url ?? null },
    progress: started.progress,
    positionSeconds: 0,
    href: `/courses/${started.course.slug}/lessons/${next.id}`,
  };
}

export interface CourseView {
  course: CourseRow;
  access: CourseAccess;
  /** Null when the member has no access, or it hasn't started: nothing of the course is shown. */
  outline: Outline | null;
  completed: Set<string>;
  progress: CourseProgress | null;
}

/** One course by slug, or null when there is none. */
export async function loadCourseView(supabase: SupabaseClient, slug: string, scope: MemberScope): Promise<CourseView | null> {
  const { data: course, error } = await supabase.from("courses").select("id, slug, title, description").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`courses read failed: ${error.message}`);
  if (!course) return null;

  const accessRow = scope.isAdminActing ? undefined : (await loadAccessRows(supabase, scope.memberId, [course.id])).get(course.id);
  const access = resolveCourseAccess(accessRow, scope.isAdminActing, scope.now ?? new Date());
  // Nothing of the course is shown before it's theirs to open: no access, or not started yet.
  if (access.kind === "none" || access.kind === "upcoming") return { course, access, outline: null, completed: new Set(), progress: null };

  const { modules, lessons } = await loadStructure(supabase, [course.id], scope.isAdminActing);
  const outline = buildOutline(modules as OutlineModule[], lessons as OutlineLesson[]);
  const completed = await loadCompleted(supabase, scope.memberId, outline.lessons.map((l) => l.id));
  return { course, access, outline, completed, progress: courseProgress(outline, completed) };
}

export interface LessonView {
  view: CourseView & { outline: Outline };
  lesson: OutlineLesson & { body_html: string | null };
  neighbors: LessonNeighbors;
  completed: boolean;
  video: { id: string; status: string; playbackId: string | null } | null;
  /** Seconds to start the video at: where the member left off, 0 when there is nothing worth resuming. */
  resumeSeconds: number;
  /** Staff previewing a lesson members can't open yet ("Coming soon" or a draft). Progress isn't tracked for it unless staff turn recording on. */
  preview: boolean;
  /** The lesson's downloads, in order. They're served through the download route, never by path. */
  files: LessonFileView[];
}

export interface LessonFileView {
  id: string;
  filename: string;
  size_bytes: number | null;
}

export type LessonResult =
  | { kind: "not_found" }
  /** The course is there but this member can't open lessons in it (no access, or it ended). */
  | { kind: "no_access"; view: CourseView }
  /** A "Coming soon" lesson: visible in the outline, not openable. */
  | { kind: "coming_soon"; view: CourseView & { outline: Outline } }
  | ({ kind: "ok" } & LessonView);

export async function loadLessonView(
  supabase: SupabaseClient,
  slug: string,
  lessonId: string,
  scope: MemberScope
): Promise<LessonResult> {
  const view = await loadCourseView(supabase, slug, scope);
  if (!view) return { kind: "not_found" };
  if (!view.outline || !canOpenLessons(view.access)) return { kind: "no_access", view };

  const withOutline = view as CourseView & { outline: Outline };
  const summary = view.outline.lessons.find((l) => l.id === lessonId);
  if (!summary) return { kind: "not_found" };
  // Staff acting as themselves can preview unreleased lessons; everyone else (and staff in sudo) gets "Coming soon".
  const preview = summary.state !== "open";
  if (preview && !scope.isAdminActing) return { kind: "coming_soon", view: withOutline };

  const { data: lesson, error } = await supabase
    .from("course_lessons")
    .select("body_html, video_id")
    .eq("id", lessonId)
    .single();
  if (error) throw new Error(`course_lessons read failed: ${error.message}`);

  let video: LessonView["video"] = null;
  if (lesson.video_id) {
    const { data: v, error: videoError } = await supabase
      .from("videos")
      .select("status, mux_playback_id")
      .eq("id", lesson.video_id)
      .maybeSingle();
    if (videoError) throw new Error(`videos read failed: ${videoError.message}`);
    if (v) video = { id: lesson.video_id, status: v.status, playbackId: v.mux_playback_id };
  }

  const { data: files, error: filesError } = await supabase
    .from("course_lesson_files")
    .select("id, filename, size_bytes")
    .eq("lesson_id", lessonId)
    .order("position");
  if (filesError) throw new Error(`course_lesson_files read failed: ${filesError.message}`);

  const { data: progress, error: progressError } = await supabase
    .from("lesson_progress")
    .select("last_position_seconds")
    .eq("member_id", scope.memberId)
    .eq("lesson_id", lessonId)
    .maybeSingle();
  if (progressError) throw new Error(`lesson_progress read failed: ${progressError.message}`);

  return {
    kind: "ok",
    resumeSeconds: resumeSeconds(progress ? Number(progress.last_position_seconds) : null),
    files: (files ?? []) as LessonFileView[],
    view: withOutline,
    lesson: { ...summary, body_html: lesson.body_html },
    neighbors: lessonNeighbors(view.outline, lessonId, { includeComingSoon: scope.isAdminActing }),
    completed: view.completed.has(lessonId),
    video,
    preview,
  };
}
