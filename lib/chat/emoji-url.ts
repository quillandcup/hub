import type { SupabaseClient } from "@supabase/supabase-js";

/** The public bucket holding our copies of the workspace's custom emoji (see emoji-copy.ts). Kept apart from it because that file needs sharp. */
export const SLACK_EMOJI_BUCKET = "slack-emoji";

/** Public URL of a file in the emoji bucket. */
export function emojiPublicUrl(supabase: SupabaseClient, path: string): string {
  return supabase.storage.from(SLACK_EMOJI_BUCKET).getPublicUrl(path).data.publicUrl;
}
