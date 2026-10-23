import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { isValidTimeZone } from "@/lib/time-zone";
import { ORG_TIMEZONE } from "@/lib/config";

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

/**
 * The member's secondary time zone (Settings → Preferences), shown beside their own on prickle
 * times, or null when they haven't turned it on.
 */
export const getUserSecondaryTimezone = cache(async (): Promise<string | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("secondary_timezone")
    .eq("id", user.id)
    .single();

  return isValidTimeZone(profile?.secondary_timezone) ? profile.secondary_timezone : null;
});

/**
 * The zone to show the signed-in viewer's dates in: their stored zone, or the org's while it is
 * still "browser" (before their first page load saves the detected one) or isn't a zone.
 */
export function resolveTimeZone(preference: string | null | undefined): string {
  return isValidTimeZone(preference) ? preference : ORG_TIMEZONE;
}

/** `resolveTimeZone` of the signed-in viewer's stored preference, for server components. */
export async function getViewerTimeZone(): Promise<string> {
  return resolveTimeZone(await getUserTimezonePreference());
}
