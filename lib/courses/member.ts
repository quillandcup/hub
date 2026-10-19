import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll, inBatches } from "@/lib/courses/db";
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
  | { kind: "none" };

export interface AccessRowLike {
  starts_at: string;
  ends_at: string | null;
}

export function resolveCourseAccess(row: AccessRowLike | undefined, isAdminActing: boolean, now: Date): CourseAccess {
  if (isAdminActing) return { kind: "admin" };
  if (!row || new Date(row.starts_at).getTime() > now.getTime()) return { kind: "none" };
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

async function loadStructure(supabase: SupabaseClient, courseIds: string[]) {
  const [modules, lessons] = await Promise.all([
    fetchAll(supabase, "course_modules", "id, course_id, parent_id, title, position, state", (q) => q.in("course_id", courseIds)),
    fetchAll(supabase, "course_lessons", "id, course_id, module_id, title, position, state, duration_seconds", (q) => q.in("course_id", courseIds)),
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

/** The courses a member can see: the ones they have (or had) access to, or all of them for staff. */
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

  const courses: CourseRow[] = await fetchAll(supabase, "courses", "id, slug, title, description", (q) => q.in("id", courseIds));
  const { modules, lessons } = await loadStructure(supabase, courseIds);
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
    .sort((a, b) => a.course.title.localeCompare(b.course.title));
}

export interface CourseView {
  course: CourseRow;
  access: CourseAccess;
  /** Null when the member has no access: nothing of the course is shown. */
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
  if (access.kind === "none") return { course, access, outline: null, completed: new Set(), progress: null };

  const { modules, lessons } = await loadStructure(supabase, [course.id]);
  const outline = buildOutline(modules as OutlineModule[], lessons as OutlineLesson[]);
  const completed = await loadCompleted(supabase, scope.memberId, outline.lessons.map((l) => l.id));
  return { course, access, outline, completed, progress: courseProgress(outline, completed) };
}

export interface LessonView {
  view: CourseView & { outline: Outline };
  lesson: OutlineLesson & { body_html: string | null };
  neighbors: LessonNeighbors;
  completed: boolean;
  video: { status: string; playbackId: string | null } | null;
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
  if (summary.state !== "open") return { kind: "coming_soon", view: withOutline };

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
    if (v) video = { status: v.status, playbackId: v.mux_playback_id };
  }

  return {
    kind: "ok",
    view: withOutline,
    lesson: { ...summary, body_html: lesson.body_html },
    neighbors: lessonNeighbors(view.outline, lessonId),
    completed: view.completed.has(lessonId),
    video,
  };
}
