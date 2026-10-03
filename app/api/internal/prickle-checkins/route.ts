import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { withCronHeartbeat } from "@/lib/cron-heartbeats";
import {
  checkinAnswered,
  CHECKOUT_LOOKBACK_MS,
  getActiveGoalCandidates,
  loadCalendarPrickleIdsByMember,
  loadCheckins,
  planCheckinDMs,
  resolveSlackUserIds,
  sendCheckinDM,
  sendCheckoutDMs,
  tryRecordCheckinDM,
  type GoalCandidate,
  type RecentPrickle,
  type UpcomingPrickle,
} from "@/lib/prickle-checkin-dms";

// Triggered every 5 minutes by the Supabase pg_cron job `send-prickle-checkins`
// (supabase/migrations/20261003130000_rename_nudges_to_prickle_checkins.sql).
export const maxDuration = 60;

/**
 * Prickle check-in and check-out DMs, both to members with an active writing goal (any measure);
 * answers save to their check-in (lib/prickle-checkin-dms.ts). Each tick:
 * - Check-ins: ~15-30 min before an upcoming writing prickle on the member's calendar feed
 *   (hosting, a commitment, or added by hand), how they're feeling coming in and what they need.
 *   See planCheckinDMs.
 * - Check-outs: 5 minutes after a writing prickle ends, or 10 minutes after an early leaver
 *   leaves, from live Zoom presence; failing that, once its attendance is imported (after the
 *   Zoom meeting ends). How it went, how they feel now, and progress. See sendCheckoutDMs.
 * At most one of each per member per prickle.
 */
export async function POST(request: NextRequest) {
  // Any successful poll counts as a heartbeat, including ones with nothing to send.
  return withCronHeartbeat("pre-prickle-nudges", await runPrickleCheckins(request));
}

async function runPrickleCheckins(request: NextRequest): Promise<NextResponse> {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_INTERNAL_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const candidates = await getActiveGoalCandidates(supabase);
  if (candidates.length === 0) {
    return NextResponse.json({ checkins: 0, checkouts: 0, reason: "no active writing goals" });
  }

  const now = Date.now();
  const checkins = await sendCheckins(supabase, candidates, now);
  const checkouts = await sendCheckoutDMs(supabase, await loadRecentPrickles(supabase, now), candidates, now);
  return NextResponse.json({ checkins, checkouts });
}

/** Maps prickle rows with an inner-joined prickle_types(name) to id + type name, dropping unnamed ones. */
function withTypeName<T extends object>(rows: any[], extra: (r: any) => T): (T & { id: string; typeName: string })[] {
  return rows.flatMap((r) => {
    const type = Array.isArray(r.prickle_types) ? r.prickle_types[0] : r.prickle_types;
    return type?.name ? [{ id: r.id as string, typeName: type.name as string, ...extra(r) }] : [];
  });
}

/** Writing prickles that have started and ended within CHECKOUT_LOOKBACK_MS (or not yet ended). */
async function loadRecentPrickles(supabase: SupabaseClient, now: number): Promise<RecentPrickle[]> {
  const { data } = await supabase
    .from("prickles")
    .select("id, start_time, end_time, prickle_types!inner(name, purpose)")
    .lte("start_time", new Date(now).toISOString())
    .gte("end_time", new Date(now - CHECKOUT_LOOKBACK_MS).toISOString())
    .eq("prickle_types.purpose", "writing");
  return withTypeName((data ?? []) as any[], (r) => ({ startTime: r.start_time, endTime: r.end_time }));
}

async function sendCheckins(supabase: SupabaseClient, candidates: GoalCandidate[], now: number): Promise<number> {
  const windowStart = new Date(now + 15 * 60 * 1000).toISOString();
  const windowEnd = new Date(now + 30 * 60 * 1000).toISOString();

  const { data: prickleRows } = await supabase
    .from("prickles")
    .select("id, type_id, host, start_time, prickle_types!inner(name, purpose)")
    .gte("start_time", windowStart)
    .lte("start_time", windowEnd)
    .eq("prickle_types.purpose", "writing");

  const upcomingPrickles: UpcomingPrickle[] = withTypeName((prickleRows ?? []) as any[], (r) => ({
    typeId: r.type_id,
    hostId: r.host ?? null,
    startTime: r.start_time,
  }));
  if (upcomingPrickles.length === 0) return 0;

  const memberIds = [...new Set(candidates.map((c) => c.memberId))];
  const [slackUserIdByMember, calendarPrickleIdsByMember] = await Promise.all([
    resolveSlackUserIds(supabase, memberIds),
    loadCalendarPrickleIdsByMember(supabase, memberIds, new Date(windowStart), new Date(now)),
  ]);

  const plan = planCheckinDMs(candidates, upcomingPrickles, calendarPrickleIdsByMember);
  // Answers already saved (e.g. from the prickle page) show as the DM's starting picks.
  const checkins = await loadCheckins(
    supabase,
    [...new Set(plan.map((p) => p.memberId))],
    [...new Set(plan.map((p) => p.prickle.id))]
  );

  let sent = 0;
  for (const { memberId, prickle } of plan) {
    const slackUserId = slackUserIdByMember.get(memberId);
    if (!slackUserId) continue;

    // Already fully checked in (e.g. on the prickle page): nothing to ask. Not logged, so a later
    // tick still sends if they clear an answer before the window closes.
    const saved = checkins.get(`${memberId}:${prickle.id}`) ?? null;
    if (checkinAnswered(saved)) continue;

    // Across ticks (and overlapping runs), the unique (prickle, member, kind) log row is what
    // keeps this to one DM; planCheckinDMs keeps it to one within a tick.
    const shouldSend = await tryRecordCheckinDM(supabase, prickle.id, memberId, "prickle_checkin");
    if (!shouldSend) continue;

    await sendCheckinDM(slackUserId, prickle, saved);
    sent++;
  }
  return sent;
}
