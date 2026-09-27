/**
 * Member-edited profile fields (public.member_profile_overrides, Local layer).
 *
 * Kajabi's API can't write a customer's public_bio / socials, so the Hub owns
 * member edits to bio, Facebook and X. Each field has three states
 * (migration 20260926001200):
 *
 *   null / undefined  never set in the Hub  -> follow Kajabi's value
 *   ""                set, then cleared      -> show nothing (no Kajabi fallback)
 *   non-empty string  set in the Hub         -> use it
 *
 * Instagram isn't here — it's edited in Kajabi's "Instagram Handle" custom
 * field (lib/kajabi/profile-fields.ts).
 */

export interface ProfileOverride {
  bio: string | null;
  facebook_url: string | null;
  twitter_url: string | null;
}

export type ProfileFields = ProfileOverride;

/** Stored value for a field the member cleared. */
export const CLEARED = "";

function resolveField(override: string | null | undefined, kajabiValue: string | null): string | null {
  if (override === null || override === undefined) return kajabiValue; // never set in the Hub
  return override === CLEARED ? null : override; // cleared -> nothing; otherwise the member's value
}

/** The profile fields to store on members, field by field per the three states above. */
export function applyProfileOverride(
  kajabi: ProfileFields,
  override: Partial<ProfileOverride> | null | undefined
): ProfileFields {
  return {
    bio: resolveField(override?.bio, kajabi.bio),
    facebook_url: resolveField(override?.facebook_url, kajabi.facebook_url),
    twitter_url: resolveField(override?.twitter_url, kajabi.twitter_url),
  };
}

/**
 * The override to store for one field after a save.
 *
 * - Submitted value unchanged from what the profile currently shows: keep the
 *   stored state as-is (a never-set field stays NULL and keeps following Kajabi).
 * - Blank (and it wasn't already blank): the member cleared it -> CLEARED.
 * - Anything else: an explicit Hub value, even if it equals Kajabi's.
 */
export function nextOverrideValue(
  submitted: string | null,
  currentlyShown: string | null,
  stored: string | null
): string | null {
  if (submitted === currentlyShown) return stored;
  return submitted === null ? CLEARED : submitted;
}
