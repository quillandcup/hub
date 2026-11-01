import type { Repos } from "@/lib/data/repos";
import { buildAliasMap, resolveEmail } from "@/lib/email-aliases";

type ProgressImportRepos = Pick<Repos, "aliases" | "courseProgress" | "courses" | "kajabiCourses" | "members">;

/**
 * Bronze (bronze.kajabi_lesson_progress) -> Silver lesson_progress (docs/COURSES.md, "Importing Kajabi per-lesson
 * progress"). Hub progress is member-written and Local, so this is NOT a rebuild: it only ever inserts a
 * completed row where the member has none, marked `imported_from = 'kajabi'`. It never changes or removes a
 * row that exists, whatever it says, so it can never lower Hub progress, and running it twice inserts nothing
 * the second time. It writes no member_activities rows.
 *
 * A Kajabi completion is used only when the member is found by email (their own or an active alias, never by
 * name; one email shared by several members is ambiguous and skipped), has current access to the course
 * (a `course_access` row that has not ended), and the lesson exists in Silver under the Kajabi source key.
 */

export interface CourseProgressImport {
  slug: string;
  /** Completed lessons in Bronze for the course (one per student and lesson). */
  completedInBronze: number;
  /** Students with a completed lesson, by how their email matched a member. */
  students: { matched: number; unmatched: number; ambiguous: number; withoutAccess: number };
  /** Completed lessons whose Kajabi lesson has no Silver lesson (deleted, or not synced yet). */
  orphanLessons: number;
  /** The member already has a completed row: left as it is. */
  alreadyCompleted: number;
  /** The member has a row that is not completed (started, or un-completed by them): left alone. */
  leftAlone: number;
  /** Rows inserted (or, in a dry run, that would be). */
  inserted: number;
}

export interface CourseProgressResult {
  dryRun: boolean;
  courses: CourseProgressImport[];
}

export class CourseProgressError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function importKajabiLessonProgress(
  repos: ProgressImportRepos,
  options: { courseSlug?: string; dryRun?: boolean; now?: Date } = {},
): Promise<CourseProgressResult> {
  const dryRun = options.dryRun ?? false;
  const now = options.now ?? new Date();
  const only = options.courseSlug ? await repos.courses.courseBySlug(options.courseSlug, { source: "kajabi" }) : null;
  const courses = options.courseSlug ? (only ? [only] : []) : await repos.courses.courses({ source: "kajabi" });
  if (options.courseSlug && courses.length === 0) throw new CourseProgressError(`No Kajabi course has the slug "${options.courseSlug}"`, 404);

  const [identities, aliases] = await Promise.all([repos.members.identities(), repos.aliases.emailAliases({ activeOnly: true })]);
  const aliasMap = buildAliasMap(aliases);
  const memberIdsByEmail = new Map<string, string[]>();
  for (const m of identities) {
    const key = m.email.trim().toLowerCase();
    memberIdsByEmail.set(key, [...(memberIdsByEmail.get(key) ?? []), m.id]);
  }

  const result: CourseProgressResult = { dryRun, courses: [] };
  for (const course of courses) {
    const summary: CourseProgressImport = {
      slug: course.slug,
      completedInBronze: 0,
      students: { matched: 0, unmatched: 0, ambiguous: 0, withoutAccess: 0 },
      orphanLessons: 0,
      alreadyCompleted: 0,
      leftAlone: 0,
      inserted: 0,
    };
    result.courses.push(summary);

    if (!course.source_key) continue;
    const bronze = await repos.kajabiCourses.completedLessons(course.source_key);
    summary.completedInBronze = bronze.length;
    if (bronze.length === 0) continue;

    const lessons = await repos.courses.lessonsOf([course.id], { source: "kajabi", includeHidden: true });
    const lessonIdByKey = new Map<string, string>(lessons.flatMap((l) => (l.source_key ? [[l.source_key, l.id] as [string, string]] : [])));

    const access = await repos.courseProgress.accessOfCourses([course.id]);
    const hasAccess = new Set<string>(access.filter((a) => a.ends_at === null || new Date(a.ends_at).getTime() > now.getTime()).map((a) => a.member_id));

    // Who each Bronze email is, once per email.
    const memberOfEmail = new Map<string, string | null>();
    const emails = [...new Set<string>(bronze.map((r) => r.email))];
    for (const email of emails) {
      const ids = memberIdsByEmail.get(resolveEmail(email, aliasMap)) ?? [];
      memberOfEmail.set(email, ids.length === 1 ? ids[0] : null);
      if (ids.length === 0) summary.students.unmatched++;
      else if (ids.length > 1) summary.students.ambiguous++;
    }
    const withoutAccess = new Set<string>();
    const matchedMembers = new Set<string>();

    // One candidate per (member, lesson); a member with two emails in Bronze keeps the earlier completion.
    const candidates = new Map<string, { memberId: string; lessonId: string; completedAt: string }>();
    for (const row of bronze) {
      const memberId = memberOfEmail.get(row.email);
      if (!memberId) continue;
      matchedMembers.add(memberId);
      if (!hasAccess.has(memberId)) {
        withoutAccess.add(memberId);
        continue;
      }
      const lessonId = lessonIdByKey.get(row.kajabi_lesson_id);
      if (!lessonId) {
        summary.orphanLessons++;
        continue;
      }
      const completedAt = new Date(row.completed_at ?? row.captured_at).toISOString();
      const key = `${memberId}|${lessonId}`;
      const earlier = candidates.get(key);
      if (!earlier || completedAt < earlier.completedAt) candidates.set(key, { memberId, lessonId, completedAt });
    }
    summary.students.matched = matchedMembers.size - withoutAccess.size;
    summary.students.withoutAccess = withoutAccess.size;

    // What the members already have for these lessons.
    const existing = new Map<string, string | null>();
    const lessonIds = [...new Set([...candidates.values()].map((c) => c.lessonId))];
    for (const r of await repos.courseProgress.progressOfLessons(lessonIds)) existing.set(`${r.member_id}|${r.lesson_id}`, r.completed_at);

    const toInsert: { member_id: string; lesson_id: string; completed_at: string; last_position_seconds: number; imported_from: string }[] = [];
    for (const [key, c] of candidates) {
      if (existing.has(key)) {
        if (existing.get(key)) summary.alreadyCompleted++;
        else summary.leftAlone++;
        continue;
      }
      toInsert.push({ member_id: c.memberId, lesson_id: c.lessonId, completed_at: c.completedAt, last_position_seconds: 0, imported_from: "kajabi" });
    }

    // A row the member made since the read above is never overwritten.
    if (!dryRun) await repos.courseProgress.insertProgressIfAbsent(toInsert);
    summary.inserted = toInsert.length;
  }
  return result;
}
