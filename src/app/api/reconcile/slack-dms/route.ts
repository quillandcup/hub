import { requireApiPermission } from "@/lib/supabase/api-auth";
import { pingCronHeartbeat } from "@/lib/cron-heartbeats";
import { sendOperationsAlert } from "@/lib/operations-alerts";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { projectCareFromDms } from "@/lib/care-dm";
import { DMS_STALE_HOURS, pullDmsForCoveredMembers } from "@/modules/chat/slack/dms";
import { chatSlackWritesEnabled } from "@/modules/chat/slack/post";
import { clock } from "@/lib/clock";
import { NextRequest, NextResponse } from "next/server";
import { createRepos } from "@/lib/data/repos";

export const maxDuration = 300;

/** No new member's DMs are started after this long, so the run ends inside maxDuration (a member's pull can take a minute). */
const TIME_BUDGET_MS = 200_000;
/** Filling in Hedgie Care from the tracked DMs (database reads only) stops starting work after this long, still inside maxDuration. */
const CARE_BUDGET_MS = 270_000;

/**
 * Daily reconciliation of members' Slack 1:1 DMs. The live events (`user_events` `message.im`) and the pull
 * when a member opens chat can both miss something, and the bot can't read a DM, so this pulls the DMs of
 * every member the `slack_dm_bridge` feature covers with their own token (docs/product/SLACK_BRIDGED_CHAT.md).
 * Members are taken the one pulled longest ago first, so those left when the time runs out are first next time; a run that
 * leaves anyone out is normal and says nothing, but a member not completed for `DMS_STALE_HOURS` is reported. The admin's backfill button (`?backfill=1`) repeats the run until
 * everyone is read, so a partial run is expected and neither alerts nor pings). Scheduled daily by Vercel Cron, which always invokes via GET. Does nothing off production.
 *
 * Once the DMs are pulled it fills in Hedgie Care from the DMs staff track (`projectCareFromDms`, docs/product/HEDGIE_CARE.md): who spoke
 * last on each open Slack DM engagement, from Bronze metadata only (who wrote and when). Idempotent: it only moves times forward.
 */
export async function GET(request: NextRequest) {
  const auth = await requireApiPermission(request, "data.pipeline.run");
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const backfill = new URL(request.url).searchParams.get("backfill") === "1";
  const service = createServiceRoleClient();
  try {
    if (!chatSlackWritesEnabled()) return NextResponse.json({ success: true, reconciliation: "slack-dms", skipped: "not production" });

    const started = clock.now();
    const result = await pullDmsForCoveredMembers(service, { deadline: started + TIME_BUDGET_MS });
    // A failure here is reported with the run's other problems; the DMs are pulled either way.
    const repos = createRepos(service);
    const care = await projectCareFromDms({ care: repos.care, careDms: repos.careDms, service: repos }, "all", { deadline: started + CARE_BUDGET_MS }).catch((error) => {
      console.error("[Reconciliation] Filling in Hedgie Care from tracked DMs failed:", error instanceof Error ? error.message : error);
      return error instanceof Error ? error.message : "failed";
    });
    const problems = [
      ...(typeof care === "string" ? [`Hedgie Care from tracked DMs: ${care}`] : care.incomplete ? ["Hedgie Care from tracked DMs: out of time (the rest next run)"] : []),
      // Out of time on a night is expected under Slack's rate limit (the rest is first next run); what is reported is a member not completed for days.
      ...(result.stale > 0 ? [`${result.stale} members' DMs not fully read for over ${DMS_STALE_HOURS} hours (${result.deferred} left and ${result.incomplete} partly read this run)`] : []),
      ...result.errors,
    ];
    if (backfill) {
      // The button reads the counts and errors from the response.
    } else if (problems.length > 0) {
      console.warn("[Reconciliation] Slack DM reconciliation did not finish cleanly:", problems);
      await sendOperationsAlert(repos, { type: "cron_partial_failure", job: "reconcile-slack-dms", problems });
    } else {
      await pingCronHeartbeat("reconcile-slack-dms");
    }
    return NextResponse.json({ success: true, reconciliation: "slack-dms", ...result, ...(typeof care === "string" ? {} : { care }) });
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
