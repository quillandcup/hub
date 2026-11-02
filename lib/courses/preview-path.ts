import { isId } from "@/lib/ids";

/**
 * A lesson's address as a member opens it: `/courses/<slug>/lessons/<lesson id>`. Pure, so the proxy
 * (which runs before any page) can use it.
 */
const LESSON_PATH = /^\/courses\/([a-z0-9][a-z0-9-]*)\/lessons\/([^/]+)$/;

/**
 * Where the proxy sends a signed-out visitor to a lesson address, so a link shared in Slack or a
 * message shows the lesson's title, picture and teaser instead of a bare login page. Null for any
 * other path. Whether the lesson may be shown to the public is decided by the page it lands on.
 */
export function lessonPreviewRewrite(pathname: string): string | null {
  const match = LESSON_PATH.exec(pathname);
  if (!match || !isId(match[2], "les")) return null;
  return `/lesson-preview/${match[1]}/${match[2]}`;
}

/** The address a member opens, from the course slug and lesson id. */
export function lessonPath(slug: string, lessonId: string): string {
  return `/courses/${slug}/lessons/${lessonId}`;
}

/** A course's address as a member opens it: `/courses/<slug>`. */
const COURSE_PATH = /^\/courses\/([a-z0-9][a-z0-9-]*)$/;

/**
 * Where the proxy sends a signed-out visitor to a course address, for the same reason as a lesson's: a
 * shared link shows the course's title, cover and description instead of a bare login page. Null for any
 * other path. Whether the course may be shown to the public is decided by the page it lands on.
 */
export function coursePreviewRewrite(pathname: string): string | null {
  const match = COURSE_PATH.exec(pathname);
  return match ? `/course-preview/${match[1]}` : null;
}

/** The address a member opens, from the course slug. */
export function coursePath(slug: string): string {
  return `/courses/${slug}`;
}
