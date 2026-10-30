"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { createServiceRoleClient } from "@/lib/supabase/service";

export type OptOutResult = { success: true; removed: number } | { error: string };

/**
 * "Leave me out of statistics" (the switch on /privacy). Turning it on stops the usage log recording
 * anything for this account (lib/analytics/opt-out.ts reads the flag) and removes the usage events
 * already stored under it; turning it off just lets recording follow the consent banner again.
 *
 * The flag belongs to the signed-in account, not to the member being viewed, so it is unavailable
 * while an admin views the Hub as a member. Not wrapped in `withAction`: the point is to record nothing.
 */
export async function setAnalyticsOptOut(optOut: boolean): Promise<OptOutResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const identity = await getEffectiveIdentity(user);
  if (identity?.isSudo) return { error: "This switch isn't available while viewing as a member." };

  try {
    await createRepos(await createClient()).profiles.setAnalyticsOptOut(user.id, optOut ? new Date().toISOString() : null);
  } catch (error) {
    console.error("[analytics] Saving the statistics opt-out failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't save that. Please try again." };
  }

  let removed = 0;
  if (optOut) {
    // Service role: members can't delete their own usage events, and the rows are theirs to have removed.
    const { count, error: deleteError } = await createServiceRoleClient()
      .from("analytics_events")
      .delete({ count: "exact" })
      .eq("user_id", user.id);
    if (deleteError) {
      console.error("[analytics] Removing a member's usage events failed:", deleteError.message);
      return { error: "You're left out from now on, but we couldn't remove what was recorded before. Please try again." };
    }
    removed = count ?? 0;
  }

  revalidatePath("/privacy");
  return { success: true, removed };
}
