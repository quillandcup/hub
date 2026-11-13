import { permanentRedirect } from "next/navigation";
import type { Repos } from "@/lib/data/repos";
import { currentPath } from "@/lib/gates.server";
import { coursePath } from "@/lib/courses/preview-path";

/**
 * Old course addresses. A Hub course that is published, or ever was, keeps the addresses it used to have: the database
 * records them (`course_address_redirects`, kept by a trigger on `courses`; docs/COURSES.md) and a visit to one is sent,
 * permanently, to the course's current address with the rest of the path and the query kept.
 */

/**
 * The current address the old address `slug` redirects to, or null when it isn't an old address, or when the course
 * wouldn't be shown to this caller at its current address anyway (a draft is invisible to everyone but staff acting as
 * themselves): a redirect must not tell anyone more than the course's own page would.
 */
export async function courseRedirectSlug(repos: Pick<Repos, "courses">, slug: string, scope: { isAdminActing: boolean }): Promise<string | null> {
  const canonical = await repos.courses.redirectedAddress(slug);
  if (!canonical) return null;
  const course = await repos.courses.courseBySlug(canonical);
  if (!course || (course.is_draft && !scope.isAdminActing)) return null;
  return canonical;
}

/**
 * `asked` (a path with its query, as the visitor asked for it) with its course address `from` replaced by `to`, or null when it
 * doesn't start with `/courses/<from>` (followed by a slash, a query or nothing).
 */
export function withCourseAddress(asked: string | null, from: string, to: string): string | null {
  const prefix = coursePath(from);
  if (!asked || !asked.startsWith(prefix)) return null;
  const rest = asked.slice(prefix.length);
  if (rest !== "" && !"/?".includes(rest[0])) return null;
  return `${coursePath(to)}${rest}`;
}

/** A page's `searchParams` as a query string with its `?` ("" when there are none), to carry over to a redirect. */
export function searchSuffix(searchParams: Record<string, string | string[] | undefined> | undefined): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v);
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

/**
 * For a page under `/courses/<slug>` that found no course: when `slug` is an old address, sends the visitor to the same page at the
 * current one (a 308; the path and query as they asked for it, or `fallbackRest` when the proxy didn't pass them along). Returns
 * when it isn't an old address, for the caller to answer "not found". `rest` and `fallbackRest` start with `/` or are empty.
 */
export async function redirectOldCourseAddress(
  repos: Pick<Repos, "courses">,
  slug: string,
  scope: { isAdminActing: boolean },
  fallbackRest: string
): Promise<void> {
  const to = await courseRedirectSlug(repos, slug, scope);
  if (!to) return;
  permanentRedirect(withCourseAddress(await currentPath(), slug, to) ?? `${coursePath(to)}${fallbackRest}`);
}
