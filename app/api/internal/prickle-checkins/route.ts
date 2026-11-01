import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { joinAt, loadPrickleJoinSettings } from "@/lib/prickle-join";
import { createNotifier } from "@/lib/notifications/notify";
import { withCronHeartbeat } from "@/lib/cron-heartbeats";
import { prickleTitle } from "@/lib/domain/prickle";
import { createRepos, type Repos } from "@/lib/data/repos";
import type { PrickleDetail, PrickleType } from "@/lib/data/prickles";
import {
  checkinAnswered,
  checkinMessage,
  CHECKOUT_LOOKBACK_MS,
  getActiveGoalCandidates,
  loadCalendarPrickleIdsByMember,
  loadCheckins,
  planCheckinDMs,
  loadDismissedPairs,
  sendCheckoutDMs,
  tryRecordCheckinDM,
  releaseCheckinDM,
  type GoalCandidate,
  type RecentPrickle,
  type UpcomingPrickle,
} from "@/lib/prickle-checkin-dms";

type RouteRepos = Repos;

// Triggered every 5 minutes by the Supabase pg_cron job `send-prickle-checkins`
// (supabase/migrations/20261003130000_rename_nudges_to_prickle_checkins.sql).
export const maxDuration = 60;

/**
 * Prickle check-in and check-out DMs, both to members with an active writing goal (any measure);
 * answers save to their check-in (lib/prickle-checkin-dms.ts). Each tick:
 * - Check-ins: ~15-30 min before an upcoming writing prickle on the member's calendar feed
 *   (hosting, a commitment, or added by hand), how they're feeling coming in and their intention for it.
 *   See planCheckinDMs.
 * - Check-outs: 5 minutes after a writing prickle ends, or 10 minutes after an early leaver
 *   leaves, from live Zoom presence; failing that, once its attendance is imported (after the
 *   Zoom meeting ends). Did they get what they came for, mood, the feeling, and progress. See sendCheckoutDMs.
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

  const repos = createRepos(createServiceRoleClient());

  const candidates = await getActiveGoalCandidates(repos);
  if (candidates.length === 0) {
    return NextResponse.json({ checkins: 0, checkouts: 0, reason: "no active writing goals" });
  }

  const now = Date.now();
  const checkins = await sendCheckins(repos, candidates, now);
  const checkouts = await sendCheckoutDMs(repos, await loadRecentPrickles(repos, now), candidates, now);
  return NextResponse.json({ checkins, checkouts });
}

/** Writing prickles that have started and ended within CHECKOUT_LOOKBACK_MS (or not yet ended). */
async function loadRecentPrickles(repos: RouteRepos, now: number): Promise<RecentPrickle[]> {
  const active = await repos.prickles.activeBetween({
    from: new Date(now - CHECKOUT_LOOKBACK_MS).toISOString(),
    to: new Date(now).toISOString(),
  });
  return writingPrickles(active).map((p) => ({
    id: p.id,
    typeName: p.type.name,
    title: prickleTitle(p),
    startTime: p.startTime,
    endTime: p.endTime,
  }));
}

/** The prickles whose type is for writing (only those get check-ins and check-outs), with the type known. */
function writingPrickles(prickles: PrickleDetail[]) {
  return prickles.filter((p): p is PrickleDetail & { type: PrickleType } => p.type?.purpose === "writing");
}

async function sendCheckins(repos: RouteRepos, candidates: GoalCandidate[], now: number): Promise<number> {
  const windowStart = new Date(now + 15 * 60 * 1000).toISOString();
  const windowEnd = new Date(now + 30 * 60 * 1000).toISOString();

  const starting = await repos.prickles.startingBetween({ from: windowStart, to: windowEnd, inclusiveEnd: true });
  const upcomingPrickles: UpcomingPrickle[] = writingPrickles(starting).map((p) => ({
    id: p.id,
    typeName: p.type.name,
    title: prickleTitle(p),
    typeId: p.type.id,
    hostId: p.hostId,
    startTime: p.startTime,
  }));
  if (upcomingPrickles.length === 0) return 0;

  const memberIds = [...new Set(candidates.map((c) => c.memberId))];
  const calendarPrickleIdsByMember = await loadCalendarPrickleIdsByMember(
    repos,
    memberIds,
    new Date(windowStart),
    new Date(now)
  );

  const plan = planCheckinDMs(candidates, upcomingPrickles, calendarPrickleIdsByMember);
  if (plan.length === 0) return 0;
  const plannedMemberIds = [...new Set(plan.map((p) => p.memberId))];
  const [notifier, checkins, dismissed] = await Promise.all([
    createNotifier(repos, "prickle_checkin", plannedMemberIds),
    // Answers already saved (e.g. from the prickle page) show as the DM's starting picks.
    loadCheckins(repos, plannedMemberIds, [...new Set(plan.map((p) => p.prickle.id))]),
    // Check-ins the member dismissed (a Slack button, the palette's x) never go out.
    loadDismissedPairs(repos, "checkin", [...new Set(plan.map((p) => p.prickle.id))]),
  ]);

  const joinSettings = await loadPrickleJoinSettings(repos);
  let sent = 0;
  for (const { memberId, prickle } of plan) {
    // Opted out on every channel, or unreachable on the ones they kept. Not logged, so turning
    // check-ins back on before the window closes still sends one.
    if (!notifier.canReach(memberId)) continue;

    // Already fully checked in (e.g. on the prickle page): nothing to ask. Not logged, so a later
    // tick still sends if they clear an answer before the window closes.
    const saved = checkins.get(`${memberId}:${prickle.id}`) ?? null;
    if (checkinAnswered(saved) || dismissed.has(`${memberId}:${prickle.id}`)) continue;

    // Across ticks (and overlapping runs), the unique (prickle, member, kind) log row is what
    // keeps this to one DM; planCheckinDMs keeps it to one within a tick.
    const shouldSend = await tryRecordCheckinDM(repos, prickle.id, memberId, "prickle_checkin");
    if (!shouldSend) continue;

    const delivered = await notifier.send(memberId, checkinMessage(prickle, saved, { join: joinAt(joinSettings, prickle.startTime) }));
    if (delivered.length > 0) sent++;
    else await releaseCheckinDM(repos, prickle.id, memberId, "prickle_checkin");
  }
  return sent;
}
