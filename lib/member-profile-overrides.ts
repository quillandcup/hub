/**
 * Member-edited profile fields (public.member_profile_overrides, Local layer).
 *
 * Kajabi's API can't write a customer's public_bio / socials, so the Hub owns
 * member edits to bio, Facebook and X. Member processing prefers a non-empty
 * override over the Kajabi-derived value; NULL/blank means "no override" and
 * falls back to Kajabi. Instagram isn't here — it's edited in Kajabi's
 * "Instagram Handle" custom field (lib/kajabi/profile-fields.ts).
 */

export interface ProfileOverride {
  bio: string | null;
  facebook_url: string | null;
  twitter_url: string | null;
}

export type ProfileFields = ProfileOverride;

function nonBlank(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** The profile fields to store on members: override where set, else the Kajabi value. */
export function applyProfileOverride(kajabi: ProfileFields, override: Partial<ProfileOverride> | null | undefined): ProfileFields {
  return {
    bio: nonBlank(override?.bio) ?? kajabi.bio,
    facebook_url: nonBlank(override?.facebook_url) ?? kajabi.facebook_url,
    twitter_url: nonBlank(override?.twitter_url) ?? kajabi.twitter_url,
  };
}
