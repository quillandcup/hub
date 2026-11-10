import { requireAdmin } from "@/lib/supabase/api-auth";
import { pingCronHeartbeat } from "@/lib/cron-heartbeats";
import { sendOperationsAlert } from "@/lib/operations-alerts";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { pullDmsForCoveredMembers } from "@/lib/chat/slack-dms";
import { chatSlackWritesEnabled } from "@/lib/chat/slack-post";
import { clock } from "@/lib/clock";
import { NextRequest, NextResponse } from "next/server";
import { createRepos } from "@/lib/data/repos";

export const maxDuration = 300;

/** No new member's DMs are started after this long, so the run ends inside maxDuration (a member's pull can take a minute). */
const TIME_BUDGET_MS = 200_000;

/**
 * Daily reconciliation of members' Slack 1:1 DMs. The live events (`user_events` `message.im`) and the pull
 * when a member opens chat can both miss something, and the bot can't read a DM, so this pulls the DMs of
 * every member the `slack_dm_bridge` feature covers with their own token (docs/SLACK_BRIDGED_CHAT.md).
 * Members left when the time runs out are first in line next time only by luck of the order, so a run that
 * defers anyone reports it. Scheduled daily by Vercel Cron, which always invokes via GET. Does nothing off production.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const service = createServiceRoleClient();
  try {
    if (!chatSlackWritesEnabled()) return NextResponse.json({ success: true, reconciliation: "slack-dms", skipped: "not production" });

    const result = await pullDmsForCoveredMembers(service, { deadline: clock.now() + TIME_BUDGET_MS });
    const problems = [
      ...(result.deferred > 0 ? [`${result.deferred} members' DMs left for the next run: out of time`] : []),
      ...(result.incomplete > 0 ? [`${result.incomplete} members' DMs only partly read: out of time (the rest next run)`] : []),
      ...result.errors,
    ];
    if (problems.length > 0) {
      console.warn("[Reconciliation] Slack DM reconciliation did not finish cleanly:", problems);
      await sendOperationsAlert(createRepos(service), { type: "cron_partial_failure", job: "reconcile-slack-dms", problems });
    } else {
      await pingCronHeartbeat("reconcile-slack-dms");
    }
    return NextResponse.json({ success: true, reconciliation: "slack-dms", ...result });
  } catch (error) {
    console.error("[Reconciliation] Error in Slack DM reconciliation:", error);
    await sendOperationsAlert(createRepos(service), {
      type: "cron_partial_failure",
      job: "reconcile-slack-dms",
      problems: [`failed outright: ${error instanceof Error ? error.message : "unknown error"}`],
    });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to reconcile Slack DMs" }, { status: 500 });
  }
}
