import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

/**
 * Get the user's timezone preference from their profile
 * Returns "browser" if set to auto-detect, otherwise returns IANA timezone string
 * Defaults to "browser" if no preference is stored
 *
 * Memoized per render via React cache() (a pass-through outside a render).
 */
export const getUserTimezonePreference = cache(async (): Promise<string> => {
  const user = await getCurrentUser();

  if (!user) {
    return "browser";
  }

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("timezone_preference")
    .eq("id", user.id)
    .single();

  return profile?.timezone_preference || "browser";
});
