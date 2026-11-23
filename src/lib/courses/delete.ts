import type { Repos } from "@/lib/data/repos";

/**
 * What deleting a course would remove and whether it may go, worked out without changing anything (the numbers the confirmation
 * shows, and the reasons beside the menu item). Deleting is `delete_course` (migration 20271123000000): a Hub-owned draft course
 * that no member uses, removed with its modules and lessons.
 */
export interface DeletePreview {
  modules: number;
  lessons: number;
  /** Where the course comes from: only the Hub's own can be deleted here. */
  source: string;
  /** True while members can't see the course. */
  isDraft: boolean;
  /** People with access or a grant, due access included. */
  members: number;
  /** What members left on it: lesson progress, comments, chat messages linked to a lesson. */
  activity: number;
}

/** The preview for a course, or null for an unknown one. */
export async function loadDeletePreview(repos: Pick<Repos, "courses">, courseId: string): Promise<DeletePreview | null> {
  const course = await repos.courses.courseById(courseId);
  if (!course) return null;
  const [modules, lessons, used] = await Promise.all([
    repos.courses.modulesOf([courseId], { includeHidden: true }),
    repos.courses.lessonsOf([courseId], { includeHidden: true }),
    repos.courses.memberDataOf(courseId),
  ]);
  return { modules: modules.length, lessons: lessons.length, source: course.source, isDraft: course.is_draft, members: used.members, activity: used.activity };
}
