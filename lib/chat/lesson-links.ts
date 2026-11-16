import { isId } from "@/lib/ids";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The query marker on a lesson address that asks for the share to be open to everyone in the conversation (an admin's choice). */
export const OPEN_SHARE_PARAM = "share";
export const OPEN_SHARE_VALUE = "open";

/**
 * A course lesson's page address pasted into a chat message, so a member who is already on the lesson can take its video to
 * any conversation, thread or direct message (the lesson page's "Copy link"). Looks for the first
 * address on our own origin shaped `/courses/<slug>/lessons/<lesson id>`, bare or as the message box stores a link
 * (`<url>` or `<url|label>`), with or without a query or fragment (`?t=95`). Returns the lesson id, the text without
 * that address (and the text before and after it), and whether the address carries the open-share marker (`?share=open`; only an admin sending it is
 * honored, which the caller decides). Anything else (another site, another path, a malformed id) is left alone. Pure; the caller decides
 * whether the sender may share that lesson.
 */
export function extractLessonLink(body: string, appUrl: string): { lessonId: string; body: string; before: string; after: string; openToChannel: boolean } | null {
  let origin: string;
  try {
    origin = new URL(appUrl).origin;
  } catch {
    return null;
  }
  const address = `${escapeRegExp(origin)}/courses/[^/\\s|<>]+/lessons/(les_[A-Za-z0-9]+)(?:\\?([^\\s|<>#]*))?(?:#[^\\s|<>]*)?`;
  const wrapped = new RegExp(`<${address}(?:\\|[^<>]*)?>`).exec(body);
  const bare = new RegExp(address).exec(body);
  // The earlier of the two (a bare address inside a wrapped one is the same link).
  const found = wrapped && (!bare || wrapped.index <= bare.index) ? wrapped : bare;
  if (!found || !isId(found[1], "les")) return null;
  const rest = (body.slice(0, found.index) + body.slice(found.index + found[0].length)).replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const openToChannel = new URLSearchParams(found[2] ?? "").get(OPEN_SHARE_PARAM) === OPEN_SHARE_VALUE;
  // The text either side of the address as written, for putting something in its place.
  return { lessonId: found[1], body: rest, before: body.slice(0, found.index), after: body.slice(found.index + found[0].length), openToChannel };
}

/**
 * `body` without the lesson address that became its video card, for display: the first lesson address, when it is the lesson the message
 * shares (Slack-origin messages keep the address in their text; a message sent from the Hub already had it removed). Slack's escapes are
 * left as stored. Another lesson's address, or none, leaves the text alone.
 */
export function withoutSharedLessonLink(body: string, appUrl: string, sharedLessonId: string): string {
  const found = extractLessonLink(body, appUrl);
  return found && found.lessonId === sharedLessonId ? found.body : body;
}
