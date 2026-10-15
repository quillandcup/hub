import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Make Realtime join as the signed-in member. It joins with the anon key unless it is handed the
 * member's token first, and as anon it rejects row filters and delivers nothing (the page just never
 * updates, with no error). So load the session and set its token before any channel is created; the
 * client passes on later token refreshes by itself.
 *
 * Call this, then check you have not been cancelled, then create the channel: a channel made by an
 * effect that was cancelled and then torn down would share its topic with the live one (React's
 * development double-mount does exactly that), and removing it drops the live one's events.
 */
export async function authenticateRealtime(supabase: SupabaseClient): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) await supabase.realtime.setAuth(data.session.access_token);
}
