import type { Repos } from "@/lib/data/repos";

/**
 * What duplicating a course would copy, worked out without changing anything (the numbers the confirmation shows).
 * Duplicating makes a new draft course the Hub owns (`duplicate_course`, migration 20270710000000).
 */
export interface DuplicatePreview {
  modules: number;
  lessons: number;
  /** Lessons that have a video (the copy points at the same one). */
  withVideo: number;
  /** Downloads the copy gets too (the same stored files, so nothing is uploaded again). */
  downloads: number;
  /** Modules nested deeper than the editor does: the course can't be duplicated. */
  tooDeep: boolean;
}

/** The preview for a course, or null for an unknown one. */
export async function loadDuplicatePreview(repos: Pick<Repos, "courses">, courseId: string): Promise<DuplicatePreview | null> {
  const course = await repos.courses.courseById(courseId);
  if (!course) return null;
  const [modules, lessons] = await Promise.all([repos.courses.modulesOf([courseId], { includeHidden: true }), repos.courses.lessonsOf([courseId], { includeHidden: true })]);
  const files = await repos.courses.filesOfLessons(lessons.map((l) => l.id));
  const parentOf = new Map(modules.map((m) => [m.id, m.parent_id]));
  return {
    modules: modules.length,
    lessons: lessons.length,
    withVideo: lessons.filter((l) => l.video_id !== null).length,
    downloads: files.length,
    tooDeep: modules.some((m) => m.parent_id && parentOf.get(m.parent_id)),
  };
}
