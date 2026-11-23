import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Profile pictures of the transport's people, as chat draws them. Client safe (no server imports). Our own copy lives in a public bucket
 * and is used once there is one; the transport's own address is the fallback until then. The bucket still carries the name it was
 * created with, when every picture came from Slack ("slack-avatars"): renaming it is a storage move, not a code change.
 */
export const CHAT_AVATAR_BUCKET = "slack-avatars";

/** Public URL of a file in the avatar bucket. */
export function avatarPublicUrl(supabase: SupabaseClient, path: string): string {
  return supabase.storage.from(CHAT_AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** What to draw for a person's picture: our copy once there is one, the transport's address until then. */
export function personPhotoUrl(supabase: SupabaseClient, person: { image_url: string | null; image_path?: string | null }): string | null {
  return person.image_path ? avatarPublicUrl(supabase, person.image_path) : person.image_url;
}
