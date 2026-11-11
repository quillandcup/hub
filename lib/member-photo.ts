import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A member's own profile photo, kept in our storage (public bucket, like the Slack avatar copies in
 * lib/slack-avatar-url.ts). `members.photo_url` is rebuilt by /api/process/members on every run from Kajabi, Slack and
 * Gravatar, so a photo that is the member's own is remembered as `member_profile_overrides.photo_path` and processing
 * puts its address back (see lib/member-profile-overrides.ts for the other fields that work the same way).
 */
export const MEMBER_PHOTO_BUCKET = "member-photos";

/** Public address of a file in the member photo bucket. */
export function memberPhotoPublicUrl(supabase: SupabaseClient, path: string): string {
  return supabase.storage.from(MEMBER_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** The photo address processing stores: the member's own copy when they have one, else what the sources gave. */
export function photoUrlFor(
  fromSources: string | null,
  override: { photo_path?: string | null } | null | undefined,
  publicUrl: (path: string) => string
): string | null {
  return override?.photo_path ? publicUrl(override.photo_path) : fromSources;
}
