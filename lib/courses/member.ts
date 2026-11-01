import type { Repos } from "@/lib/data/repos";
import type { CourseRecord } from "@/lib/data/courses";
import { courseImageSrc } from "@/lib/courses/image-urls";
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

type MemberCourseRepos = Pick<Repos, "courseProgress" | "courses">;

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
  /** The banner behind the course title (the course page only); our copy when there is one. */
  hero_url?: string | null;
  /** Not available to members yet: only staff acting as themselves are ever given one. */
  is_draft: boolean;
}

/** A course with its images resolved to our copy when there is one; only what the pages show (never the whole row). */
function withCourseImage(course: CourseRecord): CourseRow {
  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    description: course.description,
    thumbnail_url: courseImageSrc("course", course.id, course.thumbnail_asset_id, course.thumbnail_url),
    hero_url: courseImageSrc("hero", course.id, course.hero_asset_id, course.hero_url),
    is_draft: course.is_draft,
  };
}

export interface MemberScope {
  memberId: string;
  /** The signed-in user is staff and not in sudo. */
  isAdminActing: boolean;
  now?: Date;
}

async function loadAccessRows(repos: MemberCourseRepos, memberId: string, courseIds?: string[]) {
  const rows = await repos.courseProgress.memberAccess(memberId, courseIds);
  return new Map(rows.map((r) => [r.course_id, r as AccessRowLike]));
}

/**
 * The modules and lessons of courses. Hidden ones (Kajabi drafts) are left out unless `includeHidden`,
 * which only staff acting as themselves pass: a member's outline must never contain a draft, not even
 * its title. This is the one place the member pages read the structure, so it is the one place that decides.
 */
async function loadStructure(repos: MemberCourseRepos, courseIds: string[], includeHidden = false) {
  const courses = repos.courses;
  const [modules, lessons] = await Promise.all([courses.modulesOf(courseIds, { includeHidden }), courses.lessonsOf(courseIds, { includeHidden })]);
  return {
    modules: modules.map((m) => ({ id: m.id, course_id: m.course_id, parent_id: m.parent_id, title: m.title, position: m.position, state: m.state })),
    // Our copy of a thumbnail when there is one, the Kajabi URL until the images step has run.
    lessons: lessons.map((l) => ({
      id: l.id,
      course_id: l.course_id,
      module_id: l.module_id,
      title: l.title,
      position: l.position,
      state: l.state,
      duration_seconds: l.duration_seconds,
      excerpt: l.excerpt,
      thumbnail_url: courseImageSrc("lesson", l.id, l.thumbnail_asset_id, l.thumbnail_url),
    })),
  };
}

function loadCompleted(repos: MemberCourseRepos, memberId: string, lessonIds: string[]): Promise<Set<string>> {
  return repos.courseProgress.completedLessonIds(memberId, lessonIds);
}

/** A member's access to one course (admins acting as themselves open everything). */
export async function loadMemberCourseAccess(repos: MemberCourseRepos, scope: MemberScope, courseId: string): Promise<CourseAccess> {
  if (scope.isAdminActing) return { kind: "admin" };
  // A draft is no one's to open yet, whatever access rows exist (staff in sudo see what the member sees).
  const course = await repos.courses.courseById(courseId);
  if (!course || course.is_draft) return { kind: "none" };
  const row = (await loadAccessRows(repos, scope.memberId, [courseId])).get(courseId);
  return resolveCourseAccess(row, false, scope.now ?? new Date());
}

export interface CourseListItem {
  course: CourseRow;
  access: CourseAccess;
  progress: CourseProgress;
}

/** The courses a member can see: the ones they have (or had) access to, or all of them for staff. Current courses first, ended ones after, each by title. */
export async function loadCourseList(repos: MemberCourseRepos, scope: MemberScope): Promise<CourseListItem[]> {
  const now = scope.now ?? new Date();
  let courseIds: string[];
  let accessByCourse = new Map<string, AccessRowLike>();

  if (scope.isAdminActing) {
    // Staff acting as themselves get every course, drafts too, to preview them.
    courseIds = (await repos.courses.courses()).map((c) => c.id);
  } else {
    accessByCourse = await loadAccessRows(repos, scope.memberId);
    courseIds = Array.from(accessByCourse.keys());
  }
  if (courseIds.length === 0) return [];

  const courses: CourseRow[] = (await repos.courses.courses({ ids: courseIds }))
    .filter((c) => scope.isAdminActing || !c.is_draft)
    .map(withCourseImage);
  const { modules, lessons } = await loadStructure(repos, courseIds, scope.isAdminActing);
  const completed = await loadCompleted(repos, scope.memberId, lessons.map((l) => l.id));

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
export async function loadContinueWatching(repos: MemberCourseRepos, scope: MemberScope): Promise<ContinueWatching | null> {
  if (scope.isAdminActing) return null;
  const items = (await loadCourseList(repos, scope)).filter((i) => i.access.kind === "open");
  if (items.length === 0) return null;
  const byCourse = new Map(items.map((i) => [i.course.id, i]));
  const rows = await repos.courseProgress.partlyWatched(scope.memberId, 50);
  const positions = new Map(rows.map((r) => [r.lesson_id, r.last_position_seconds]));

  const openLessons = (lessonIds: string[]) => repos.courses.openLessons(lessonIds);

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
export async function loadCourseView(repos: MemberCourseRepos, slug: string, scope: MemberScope): Promise<CourseView | null> {
  const courseRow = await repos.courses.courseBySlug(slug);
  // A draft is there for staff acting as themselves to preview; to everyone else (staff in sudo too) it doesn't exist.
  if (!courseRow || (courseRow.is_draft && !scope.isAdminActing)) return null;
  const course = withCourseImage(courseRow);

  const accessRow = scope.isAdminActing ? undefined : (await loadAccessRows(repos, scope.memberId, [course.id])).get(course.id);
  const access = resolveCourseAccess(accessRow, scope.isAdminActing, scope.now ?? new Date());
  // Nothing of the course is shown before it's theirs to open: no access, or not started yet.
  if (access.kind === "none" || access.kind === "upcoming") return { course, access, outline: null, completed: new Set(), progress: null };

  const { modules, lessons } = await loadStructure(repos, [course.id], scope.isAdminActing);
  const outline = buildOutline(modules as OutlineModule[], lessons as OutlineLesson[]);
  const completed = await loadCompleted(repos, scope.memberId, outline.lessons.map((l) => l.id));
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
  repos: MemberCourseRepos,
  slug: string,
  lessonId: string,
  scope: MemberScope
): Promise<LessonResult> {
  const view = await loadCourseView(repos, slug, scope);
  if (!view) return { kind: "not_found" };
  if (!view.outline || !canOpenLessons(view.access)) return { kind: "no_access", view };

  const withOutline = view as CourseView & { outline: Outline };
  const summary = view.outline.lessons.find((l) => l.id === lessonId);
  if (!summary) return { kind: "not_found" };
  // Staff acting as themselves can preview unreleased lessons; everyone else (and staff in sudo) gets "Coming soon".
  const preview = summary.state !== "open";
  if (preview && !scope.isAdminActing) return { kind: "coming_soon", view: withOutline };
  const lesson = await repos.courses.lessonBody(lessonId);
  if (!lesson) return { kind: "not_found" };

  let video: LessonView["video"] = null;
  if (lesson.video_id) {
    const v = (await repos.courses.videosByIds([lesson.video_id]))[0];
    if (v) video = { id: lesson.video_id, status: v.status, playbackId: v.mux_playback_id };
  }

  // Only what the page shows: the storage path stays on the server.
  const files = (await repos.courses.lessonFiles(lessonId)).map((f) => ({ id: f.id, filename: f.filename, size_bytes: f.size_bytes }));
  const position = await repos.courseProgress.lessonPosition(scope.memberId, lessonId);

  return {
    kind: "ok",
    resumeSeconds: resumeSeconds(position),
    files,
    view: withOutline,
    lesson: { ...summary, body_html: lesson.body_html },
    neighbors: lessonNeighbors(view.outline, lessonId, { includeComingSoon: scope.isAdminActing }),
    completed: view.completed.has(lessonId),
    video,
    preview,
  };
}
