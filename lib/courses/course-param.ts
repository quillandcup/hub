import type { Repos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";

/**
 * The course id for an admin address's course segment: the id, or the course's slug, so a member's
 * `/courses/<slug>/lessons/<id>` opens its admin page by putting `/admin` in front. Anything else is
 * returned as it came, for the caller to turn into "not found".
 */
export async function resolveCourseParam(repos: Pick<Repos, "courses">, param: string): Promise<string> {
  if (isId(param, "crs")) return param;
  return (await repos.courses.courseBySlug(param))?.id ?? param;
}
