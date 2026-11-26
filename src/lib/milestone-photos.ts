import { MILESTONE_PHOTO } from "@/lib/config";
import type { Visibility } from "@/lib/writing-visibility";

/**
 * Photos on milestones (docs/product/FINISHERS.md, "Photos"): the rules for who may be handed a picture, the address it is
 * asked for and how long it may be cached. A plain module with no server imports, so the route, the repositories and the
 * strips share it. The bytes are handled in `src/lib/members/milestone-photo.ts`.
 *
 * A photo is personal. It sits in a private bucket and is served only by the route, which checks the viewer against the
 * milestone's level every time. Its address carries a random token, never an id of ours and never the member's id.
 */

export const MILESTONE_PHOTO_BUCKET = "milestone-photos";

/** What a stored photo can be attached to: a milestone (THE END, publish-ready) or the Bookshelf book of the Published step. */
export type PhotoTarget = "milestone" | "book";

/** The file name without its extension: 128 random bits as hex. */
export const PHOTO_TOKEN_PATTERN = /^[0-9a-f]{32}$/;

export function isPhotoToken(value: unknown): value is string {
  return typeof value === "string" && PHOTO_TOKEN_PATTERN.test(value);
}

/** The address a picture is asked for. The route decides, on every request, whether the viewer may have it. */
export function milestonePhotoSrc(token: string): string {
  return `/api/milestone-photos/${token}`;
}

/** Where a member's photo is kept: their own folder, a random name. */
export function milestonePhotoPath(memberId: string, token: string): string {
  return `${memberId}/${token}.webp`;
}

/** The token in a stored path (`<member id>/<token>.webp`), or null for anything else. */
export function tokenOfPath(path: string | null | undefined): string | null {
  const match = path ? /^[^/]+\/([0-9a-f]{32})\.webp$/.exec(path) : null;
  return match ? match[1] : null;
}

/** The photo of a step as the member's own page and the strips use it: what to ask for and what to say it shows. */
export type StepPhoto = { token: string; alt: string | null };

/** What the viewer is, as far as seeing a photo goes. A signed-in user with no member record (staff only) has no `memberId`. */
export type PhotoViewer = { signedIn: boolean; memberId: string | null; isStaff: boolean };

export const ANONYMOUS_VIEWER: PhotoViewer = { signedIn: false, memberId: null, isStaff: false };

/** The milestone a photo belongs to, as far as seeing it goes. */
export type PhotoSubject = {
  ownerId: string;
  /** The milestone's level (Published is derived and is the globe). */
  level: Visibility;
  /** "Allow us to celebrate you publicly": the member's consent for the team to use it. A book photo has none. */
  consentTestimonial: boolean;
};

export type PhotoDecision = { allowed: false } | { allowed: true; cache: "web" | "private" };

/**
 * Who may be handed a photo (the single rule, used by the route and tested at every level):
 *   - the member it is about, whatever the level (a staff member viewing as them is the member);
 *   - another signed-in member at the house or the globe, never at the lock;
 *   - a visitor with no sign-in at the globe only, and only while the member's page is on (`webOn`: the `writer_profiles` flag and
 *     the page itself, decided by the caller, who knows the member);
 *   - staff who are not that member only when the member ticked the consent to share their story, whatever the level: a photo at the
 *     lock is not shown to the team for any other reason.
 * `cache: "web"` says a shared cache may keep it, which is true only when the visitor rule itself passes, so nothing a visitor may
 * not have is ever cached where a visitor could be served it.
 */
export function decidePhotoAccess(subject: PhotoSubject, viewer: PhotoViewer, webOn: boolean): PhotoDecision {
  const visitorMay = subject.level === "public" && webOn;
  const cache = visitorMay ? ("web" as const) : ("private" as const);
  if (viewer.memberId !== null && viewer.memberId === subject.ownerId) return { allowed: true, cache };
  if (viewer.signedIn && viewer.memberId !== null && subject.level !== "private") return { allowed: true, cache };
  if (visitorMay) return { allowed: true, cache };
  if (viewer.isStaff && subject.consentTestimonial) return { allowed: true, cache };
  return { allowed: false };
}

/**
 * The Cache-Control of a served photo. Anything not meant for everyone on the web is private (the browser may keep it for the
 * member who asked, no shared cache may keep it) and not stored at all, so a changed level or a taken-back photo is gone on the
 * next request. A photo that is on the web may sit in a shared cache for a short time (`webCacheSeconds`): that is the delay for a
 * withdrawn globe photo to stop being served from the edge, which is why it is a minute and no more.
 */
export function photoCacheControl(cache: "web" | "private"): string {
  return cache === "web" ? `public, max-age=${MILESTONE_PHOTO.webCacheSeconds}, s-maxage=${MILESTONE_PHOTO.webCacheSeconds}` : "private, no-store";
}

/** The description of a photo as the member wrote it: one line of plain text, or null when empty. */
export function parsePhotoAlt(input: unknown): { alt: string | null } | { error: string } {
  if (input === null || input === undefined) return { alt: null };
  if (typeof input !== "string") return { error: "That description isn't something we can save." };
  const text = input.replace(/\s+/g, " ").trim();
  if (text === "") return { alt: null };
  if (text.length > MILESTONE_PHOTO.altMaxLength) return { error: `Please keep the description under ${MILESTONE_PHOTO.altMaxLength} characters.` };
  return { alt: text };
}

/** The most a file may be, in words for a member ("4 MB"). */
export const MAX_MILESTONE_UPLOAD_LABEL = `${Math.floor(MILESTONE_PHOTO.maxUploadBytes / (1024 * 1024))} MB`;
