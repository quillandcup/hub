import type { SupabaseClient } from "@supabase/supabase-js";

/** The public bucket holding our copies of Slack profile photos (see lib/chat/avatar-copy.ts). Kept apart from it because that file needs sharp. */
export const SLACK_AVATAR_BUCKET = "slack-avatars";

/** Public URL of a file in the avatar bucket. */
export function avatarPublicUrl(supabase: SupabaseClient, path: string): string {
  return supabase.storage.from(SLACK_AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** What to draw for a Slack user's photo: our copy once there is one, Slack's address until then. */
export function slackPhotoUrl(supabase: SupabaseClient, user: { image_url: string | null; image_path?: string | null }): string | null {
  return user.image_path ? avatarPublicUrl(supabase, user.image_path) : user.image_url;
}
