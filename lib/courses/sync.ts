import type { ProcessRepos } from "@/lib/courses/process";
import { importKajabiCourses, type CoursesImportResult, type KajabiCoursesApi } from "@/lib/courses/import";
import { processCourses, type ProcessCoursesResult } from "@/lib/courses/process";
import { slugifyTitle } from "@/lib/courses/visibility";

/**
 * The course half of the standard Kajabi sync (docs/COURSES.md, "Ongoing sync after launch"):
 * import every course's structure into Bronze (step A), then refresh the courses already
 * published in the Hub (step C), which also rebuilds `course_access` from the purchases the
 * member import just stored. Run it after the member import so access reflects fresh purchases.
 *
 * It never publishes a new course by itself (publishing takes a decision: access length): it
 * lists the imported courses that aren't published yet. And it never throws: a courses problem
 * must not fail the member sync it rides on, so errors come back in the result instead.
 */

export interface CoursesSyncResult {
  imported?: CoursesImportResult;
  processed?: ProcessCoursesResult["courses"];
  /** Imported Kajabi courses with no published Hub course yet; `slug` is what publishing would use. */
  unpublished?: { id: string; title: string; slug: string }[];
  error?: string;
}

export async function syncKajabiCourses(repos: ProcessRepos, kajabi: KajabiCoursesApi): Promise<CoursesSyncResult> {
  const result: CoursesSyncResult = {};
  try {
    result.imported = await importKajabiCourses(repos, kajabi);

    const published = await repos.courses.courses({ source: "kajabi", isDraft: false });
    const publishedKeys = new Set(published.map((c) => c.source_key));
    result.unpublished = result.imported.courses
      .filter((c) => !publishedKeys.has(c.id))
      .map((c) => ({ id: c.id, title: c.title, slug: slugifyTitle(c.title) }));

    result.processed = (await processCourses(repos)).courses;
  } catch (error: any) {
    console.error("Kajabi courses sync failed:", error);
    result.error = error?.message || "Courses sync failed";
  }
  return result;
}
