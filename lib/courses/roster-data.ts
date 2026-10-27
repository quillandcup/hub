import { getMemberDisplayName } from "@/lib/member-display-name";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import { fetchAll, inBatches } from "@/lib/courses/db";
import { buildRoster, type RosterAccess, type RosterLesson, type RosterProgress, type RosterRow } from "@/lib/courses/roster";

/**
 * The roster page's data (service role, behind `requireAdminPage()`): everyone with access to the
 * course and their lesson progress, in a handful of batched reads (never a query per member).
 * Null when the course isn't in the Hub.
 */
export async function loadCourseRoster(
  supabase: SupabaseClient,
  kajabiId: string,
  now: Date = new Date()
): Promise<{ course: { id: string; title: string }; rows: RosterRow[] } | null> {
  const { data: course, error } = await supabase.from("courses").select("id, title").eq("source", "kajabi").eq("source_key", kajabiId).maybeSingle();
  if (error) throw new Error(`courses read failed: ${error.message}`);
  if (!course) return null;

  const [accessRows, lessonRows] = await Promise.all([
    fetchAll(supabase, "course_access", "member_id, starts_at, ends_at, origin", (q) => q.eq("course_id", course.id).order("member_id")),
    fetchAll(supabase, "course_lessons", "id, title, state", (q) => q.eq("course_id", course.id).order("id")),
  ]);
  const lessons: RosterLesson[] = lessonRows.map((l) => ({ id: l.id, title: l.title, state: l.state }));
  const access: RosterAccess[] = accessRows.map((a) => ({ memberId: a.member_id, startsAt: a.starts_at, endsAt: a.ends_at, origin: a.origin }));

  const progressBatches = await Promise.all(
    inBatches(lessons.map((l) => l.id)).map((ids) =>
      fetchAll(supabase, "lesson_progress", "member_id, lesson_id, completed_at, updated_at", (q) => q.in("lesson_id", ids).order("member_id").order("lesson_id"))
    )
  );
  const progress: RosterProgress[] = progressBatches.flat().map((p) => ({ memberId: p.member_id, lessonId: p.lesson_id, completedAt: p.completed_at, updatedAt: p.updated_at }));

  const members = await createRepos(supabase).members.byIds(access.map((a) => a.memberId));
  const names = new Map(members.map((m) => [m.id, getMemberDisplayName({ name: m.name, display_name: m.displayName })]));
  const realNames = new Map(members.filter((m) => getMemberDisplayName({ name: m.name, display_name: m.displayName }) !== m.name).map((m) => [m.id, m.name]));
  return { course: { id: course.id, title: course.title }, rows: buildRoster(access, names, lessons, progress, now, realNames) };
}
