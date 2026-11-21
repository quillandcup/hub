import { APP_URL, WRITER_PROFILES } from "@/lib/config";
import { getMemberDisplayName } from "@/lib/member-display-name";

/**
 * A writer's public page (docs/WRITER_PROFILES.md): the rules that are not a database query. The handle's shape, the words
 * nobody can choose, the name shown, the photo that may be shown and the one function that decides whether a page is served.
 */

/** The path every page is under: `/w/<handle>`. */
export const WRITER_PAGE_PATH = "/w";

/** Where a member sees their own page as a visitor would, whether or not it is on (a member-only route, never indexed). */
export const WRITER_PREVIEW_PATH = "/writer-page/preview";

/** The address of a page, relative (for a link or a redirect). */
export function writerPagePath(handle: string): string {
  return `${WRITER_PAGE_PATH}/${handle}`;
}

/** The full address of a page: the canonical URL, the one in the sitemap and in the structured data. */
export function writerPageUrl(handle: string): string {
  return `${APP_URL}${writerPagePath(handle)}`;
}

/** Letters and digits, with single hyphens between (never at either end, never two in a row). */
const HANDLE_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type HandleProblem = "empty" | "too_short" | "too_long" | "characters" | "reserved";

export const HANDLE_PROBLEM_MESSAGES: Record<HandleProblem, string> = {
  empty: "Choose an address for your page.",
  too_short: `Use at least ${WRITER_PROFILES.handleMinLength} characters.`,
  too_long: `Use at most ${WRITER_PROFILES.handleMaxLength} characters.`,
  characters: "Use lowercase letters and numbers, with single hyphens between words (like ada-example).",
  reserved: "That address is kept for the community. Choose another.",
};

/** Whether an address could be a handle at all (letters, digits and single hyphens, any case), whatever its length or whether it is kept. */
export function isHandleShaped(input: string): boolean {
  return HANDLE_SHAPE.test(input.toLowerCase()) && input.length <= 63;
}

/** What a person typed, made into what is stored: trimmed and lowercase. */
export function normalizeHandle(input: string): string {
  return input.trim().toLowerCase();
}

const stripHyphens = (value: string) => value.replace(/-/g, "");
const RESERVED = new Set<string>(WRITER_PROFILES.reservedHandles.map(stripHyphens));

/** True when the handle is one of the kept words (hyphens aside, so "quill-and-cup" is held by "quillandcup"). */
export function isReservedHandle(handle: string): boolean {
  return RESERVED.has(stripHyphens(normalizeHandle(handle)));
}

export type HandleCheck = { ok: true; handle: string } | { ok: false; problem: HandleProblem; message: string };

/** Checks a handle against every rule that does not need the database (taken or held is the database's to say). */
export function validateHandle(input: string): HandleCheck {
  const handle = normalizeHandle(input);
  const fail = (problem: HandleProblem): HandleCheck => ({ ok: false, problem, message: HANDLE_PROBLEM_MESSAGES[problem] });
  if (!handle) return fail("empty");
  if (!HANDLE_SHAPE.test(handle)) return fail("characters");
  if (handle.length < WRITER_PROFILES.handleMinLength) return fail("too_short");
  if (handle.length > WRITER_PROFILES.handleMaxLength) return fail("too_long");
  if (isReservedHandle(handle)) return fail("reserved");
  return { ok: true, handle };
}

/** A handle to start from, made from the name shown ("Ada Example" is "ada-example"), or "" when nothing usable is left. */
export function suggestHandle(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, WRITER_PROFILES.handleMaxLength)
    .replace(/-+$/g, "");
  return validateHandle(base).ok ? base : "";
}

/** What setting a handle can come back with (the database function `set_writer_handle`). */
export type SetHandleOutcome = "created" | "changed" | "unchanged" | "taken" | "reserved";

/** Plain words for a handle that cannot be had. */
export const HANDLE_UNAVAILABLE_MESSAGES = {
  taken: "Someone already uses that address. Choose another.",
  reserved: "That address was just given up by someone and is held for them for a while. Choose another.",
} as const;

/** The most a bio can hold, from config. */
export const BIO_MAX_LENGTH: number = WRITER_PROFILES.bioMaxLength;

/** The bio as it is stored: plain text, trimmed, runs of blank lines folded; null when nothing is left. */
export function cleanBio(input: string | null | undefined): { ok: true; bio: string | null } | { ok: false; message: string } {
  const bio = (input ?? "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (bio.length > BIO_MAX_LENGTH) return { ok: false, message: `Keep your bio to ${BIO_MAX_LENGTH} characters or fewer.` };
  return { ok: true, bio: bio || null };
}

/** The photo address for a public page, or null when there is none or it must not be published (not https, or from a host listed in config). */
export function publishablePhotoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase();
    if (WRITER_PROFILES.unpublishablePhotoHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) return null;
    return url;
  } catch {
    return null;
  }
}

/** A link for a public page: an https address, or null. A member's own text can hold anything, and only https goes on the open web. */
export function publishableLink(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** What the name shown can be: the display name, or one of the pen names the member allowed on their page. */
export function publicName(member: { name: string; display_name?: string | null }, penName: string | null): string {
  const pen = penName?.trim();
  return pen || getMemberDisplayName(member);
}

/**
 * THE choke point: whether a member's page may be shown to a visitor. Everything that serves or lists a page asks here
 * (the page, the redirect from an old handle, the sitemap), so a rule about who may have one lives in one place.
 *
 * Today a page is served unless it was removed (`deletedAt`). A member who is removed has no row left at all (their page
 * goes with them).
 *
 * TODO(docs/TODO.md: "What may leads, former members and members on hiatus do?"): the owner has not decided whether the
 * page of a former member, or of one on hiatus, stays up. Do not guess here: that decision goes in this function, and
 * `memberStatus` is already passed in for it.
 */
export function isProfilePubliclyServable(profile: { deletedAt: string | null; memberStatus: string }): boolean {
  return profile.deletedAt === null;
}
