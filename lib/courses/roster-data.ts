import { getMemberDisplayName } from "@/lib/member-display-name";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import { buildRoster, type RosterAccess, type RosterLesson, type RosterProgress, type RosterRow } from "@/lib/courses/roster";

/**
 * The roster page's data (service role, behind `requireAdminPage()`): everyone with access to the
 * course and their lesson progress, in a handful of batched reads (never a query per member).
 * Null when the course isn't in the Hub.
 */
export async function loadCourseRoster(
  supabase: SupabaseClient,
  courseId: string,
  now: Date = new Date()
): Promise<{ course: { id: string; title: string }; rows: RosterRow[] } | null> {
  const repos = createRepos(supabase);
  const course = await repos.courses.courseById(courseId);
  if (!course || course.is_draft) return null;

  const [accessRows, lessonRows] = await Promise.all([repos.courseProgress.accessOfCourses([course.id]), repos.courses.lessonsOf([course.id], { includeHidden: true })]);
  const lessons: RosterLesson[] = lessonRows.map((l) => ({ id: l.id, title: l.title, state: l.state }));
  const access: RosterAccess[] = accessRows.map((a) => ({ memberId: a.member_id, startsAt: a.starts_at, endsAt: a.ends_at, origin: a.origin as RosterAccess["origin"] }));

  const progress: RosterProgress[] = (await repos.courseProgress.progressOfLessons(lessons.map((l) => l.id))).map((p) => ({ memberId: p.member_id, lessonId: p.lesson_id, completedAt: p.completed_at, updatedAt: p.updated_at }));

  const members = await repos.members.byIds(access.map((a) => a.memberId));
  const names = new Map(members.map((m) => [m.id, getMemberDisplayName({ name: m.name, display_name: m.displayName })]));
  const realNames = new Map(members.filter((m) => getMemberDisplayName({ name: m.name, display_name: m.displayName }) !== m.name).map((m) => [m.id, m.name]));
  return { course: { id: course.id, title: course.title }, rows: buildRoster(access, names, lessons, progress, now, realNames) };
}
