import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";

/**
 * "Leave me out of statistics" (the switch on /privacy): while `user_profiles.analytics_opt_out_at`
 * is set, nothing is recorded in the usage log for that account. This is the one place that reads
 * it. The browser stops reporting (components/AnalyticsEvents.tsx), the receiver and the server-side
 * recorders skip the member, and Google Analytics is denied, so the switch holds even for a stale tab
 * or a visit cookie that is still alive. It covers how the member uses the Hub, not what the app does on its own:
 * `notification_sent` (source `system`) is still recorded, and is kept when the switch is turned on.
 */

/** Whether this account has opted out. A lookup that fails counts as not opted out, the same as no profile. */
export const isAnalyticsOptedOut = cache(async (userId: string): Promise<boolean> => {
  try {
    return await createRepos(await createClient()).profiles.analyticsOptedOut(userId);
  } catch {
    return false;
  }
});
