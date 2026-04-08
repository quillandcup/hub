import { createClient } from "@/lib/supabase/server";

/**
 * Get the user's timezone preference from their profile
 * Returns "browser" if set to auto-detect, otherwise returns IANA timezone string
 * Defaults to "browser" if no preference is stored
 */
export async function getUserTimezonePreference(): Promise<string> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return "browser";
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("timezone_preference")
    .eq("id", user.id)
    .single();

  return profile?.timezone_preference || "browser";
}
