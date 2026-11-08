import { isId } from "@/lib/ids";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A course lesson's page address pasted into a chat message, so a member who is already on the lesson can take its video to
 * any conversation, thread or direct message (the lesson page's "Copy link to paste in chat"). Looks for the first
 * address on our own origin shaped `/courses/<slug>/lessons/<lesson id>`, bare or as the message box stores a link
 * (`<url>` or `<url|label>`), with or without a query or fragment (`?t=95`). Returns the lesson id and the text without
 * that address. Anything else (another site, another path, a malformed id) is left alone. Pure; the caller decides
 * whether the sender may share that lesson.
 */
export function extractLessonLink(body: string, appUrl: string): { lessonId: string; body: string } | null {
  let origin: string;
  try {
    origin = new URL(appUrl).origin;
  } catch {
    return null;
  }
  const address = `${escapeRegExp(origin)}/courses/[^/\\s|<>]+/lessons/(les_[A-Za-z0-9]+)(?:[?#][^\\s|<>]*)?`;
  const wrapped = new RegExp(`<${address}(?:\\|[^<>]*)?>`).exec(body);
  const bare = new RegExp(address).exec(body);
  // The earlier of the two (a bare address inside a wrapped one is the same link).
  const found = wrapped && (!bare || wrapped.index <= bare.index) ? wrapped : bare;
  if (!found || !isId(found[1], "les")) return null;
  const rest = (body.slice(0, found.index) + body.slice(found.index + found[0].length)).replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { lessonId: found[1], body: rest };
}
