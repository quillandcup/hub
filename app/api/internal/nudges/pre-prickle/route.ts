import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { sendSlackDM } from "@/lib/slack";
import { withCronHeartbeat } from "@/lib/cron-heartbeats";
import {
  getActiveGoalCandidates,
  loadCalendarPrickleIdsByMember,
  planPrePrickleNudges,
  resolveSlackUserIds,
  tryRecordNudge,
  type UpcomingPrickle,
} from "@/lib/writing-nudges";

// Triggered every 5 minutes by the Supabase pg_cron job in
// supabase/migrations/20260831170001_enable_pg_cron_pre_prickle_nudges.sql.
export const maxDuration = 60;

/**
 * Phase 1, item 9: pre-prickle nudge. Sends a DM ~15-30 min before an upcoming prickle to every
 * member with an active writing goal (any measure) who has that prickle on their calendar feed
 * (hosting, a commitment, or added by hand) -- at most one DM per member per prickle. See planPrePrickleNudges and
 * docs/superpowers/specs/writing-projects-tracking.md.
 */
export async function POST(request: NextRequest) {
  // Any successful poll counts as a heartbeat, including ones with nothing to send.
  return withCronHeartbeat("pre-prickle-nudges", await sendPrePrickleNudges(request));
}

async function sendPrePrickleNudges(request: NextRequest): Promise<NextResponse> {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_INTERNAL_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const candidates = await getActiveGoalCandidates(supabase);
  if (candidates.length === 0) {
    return NextResponse.json({ sent: 0, reason: "no active writing goals" });
  }

  const now = Date.now();
  const windowStart = new Date(now + 15 * 60 * 1000).toISOString();
  const windowEnd = new Date(now + 30 * 60 * 1000).toISOString();

  const { data: prickleRows } = await supabase
    .from("prickles")
    .select("id, type_id, host, start_time, prickle_types!inner(name, purpose)")
    .gte("start_time", windowStart)
    .lte("start_time", windowEnd)
    .eq("prickle_types.purpose", "writing");

  const upcomingPrickles: UpcomingPrickle[] = ((prickleRows ?? []) as any[])
    .map((r) => {
      const type = Array.isArray(r.prickle_types) ? r.prickle_types[0] : r.prickle_types;
      return type?.name
        ? { id: r.id, typeId: r.type_id, hostId: r.host ?? null, startTime: r.start_time, typeName: type.name as string }
        : null;
    })
    .filter((p): p is UpcomingPrickle => p !== null);

  if (upcomingPrickles.length === 0) {
    return NextResponse.json({ sent: 0, reason: "no writing-purpose prickles in the 15-30min window" });
  }

  const memberIds = [...new Set(candidates.map((c) => c.memberId))];
  const [slackUserIdByMember, calendarPrickleIdsByMember] = await Promise.all([
    resolveSlackUserIds(supabase, memberIds),
    loadCalendarPrickleIdsByMember(supabase, memberIds, new Date(windowStart), new Date(now)),
  ]);

  let sent = 0;
  for (const { memberId, prickle } of planPrePrickleNudges(candidates, upcomingPrickles, calendarPrickleIdsByMember)) {
    const slackUserId = slackUserIdByMember.get(memberId);
    if (!slackUserId) continue;

    // Across ticks (and overlapping runs), the unique (prickle, member, kind) log row is what
    // keeps this to one DM; planPrePrickleNudges keeps it to one within a tick.
    const shouldSend = await tryRecordNudge(supabase, prickle.id, memberId, "pre_prickle_nudge");
    if (!shouldSend) continue;

    await sendSlackDM({
      slackUserId,
      text: `Ready for ${prickle.typeName} in ~20 min? Start thinking about what you'll dig into today ✍️`,
    });
    sent++;
  }

  return NextResponse.json({ sent });
}
