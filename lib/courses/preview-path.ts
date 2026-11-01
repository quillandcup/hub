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
