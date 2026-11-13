import type { Repos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";

/**
 * The course id for an admin address's course segment: the id, or the course's slug, so a member's
 * `/courses/<slug>/lessons/<id>` opens its admin page by putting `/admin` in front. Anything else is
 * returned as it came, for the caller to turn into "not found".
 */
export async function resolveCourseParam(repos: Pick<Repos, "courses">, param: string): Promise<string> {
  if (isId(param, "crs")) return param;
  const course = await repos.courses.courseBySlug(param);
  if (course) return course.id;
  // An address the course used to have: an old link to its admin page still opens it.
  const current = await repos.courses.redirectedAddress(param);
  return (current && (await repos.courses.courseBySlug(current))?.id) || param;
}
