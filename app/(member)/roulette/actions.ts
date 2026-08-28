"use server";

import { WebClient } from "@slack/web-api";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";
import {
  pickRouletteMatch,
  buildReel,
  type RouletteCandidate,
} from "@/lib/roulette";

const BATCH_SIZE = 1000;
const SLACK_ACTIVITY_WINDOW_DAYS = 45;
const REEL_SLOT_COUNT = 8;

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function fetchAllPaginated<T>(
  queryFn: (offset: number) => PromiseLike<{ data: T[] | null }>
): Promise<T[]> {
  let all: T[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data } = await queryFn(offset);
    if (data && data.length > 0) {
      all = all.concat(data);
      offset += data.length;
      hasMore = data.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }
  return all;
}

export interface RouletteWinner {
  memberId: string;
  memberName: string;
  photoUrl: string | null;
  dmUrl: string;
}

export interface RouletteSpinResult {
  winner: RouletteWinner;
  reel: { memberId: string; memberName: string; photoUrl: string | null }[];
}

export type RouletteSpinResponse =
  | RouletteSpinResult
  | { error: string }
  | { noOneAvailable: true };

async function loadCandidatePool(
  supabase: SupabaseClient,
  viewerMemberId: string
): Promise<RouletteCandidate[]> {
  const activityWindowStart = new Date(
    Date.now() - SLACK_ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const [membersResult, attendance, slackActivity, slackAliases] = await Promise.all([
    supabase
      .from("members")
      .select("id, name, photo_url")
      .eq("status", "active")
      .neq("id", viewerMemberId),
    fetchAllPaginated<{ member_id: string; prickle_id: string }>((offset) =>
      supabase
        .from("prickle_attendance")
        .select("member_id, prickle_id")
        .range(offset, offset + BATCH_SIZE - 1)
    ),
    fetchAllPaginated<{ member_id: string }>((offset) =>
      supabase
        .from("member_activities")
        .select("member_id")
        .eq("source", "slack")
        .gte("occurred_at", activityWindowStart)
        .range(offset, offset + BATCH_SIZE - 1)
    ),
    fetchAllPaginated<{ member_id: string; alias: string }>((offset) =>
      supabase
        .from("member_name_aliases")
        .select("member_id, alias")
        .eq("source", "slack")
        .range(offset, offset + BATCH_SIZE - 1)
    ),
  ]);

  const members = membersResult.data ?? [];

  // Connection count: distinct other members each member has ever shared a
  // prickle with (all-time — a lifetime near-zero count is the clearest
  // isolation signal, not just a recent lull).
  const membersByPrickle = new Map<string, Set<string>>();
  for (const row of attendance) {
    if (!membersByPrickle.has(row.prickle_id)) membersByPrickle.set(row.prickle_id, new Set());
    membersByPrickle.get(row.prickle_id)!.add(row.member_id);
  }
  const connectionsByMember = new Map<string, Set<string>>();
  for (const attendees of membersByPrickle.values()) {
    for (const memberId of attendees) {
      if (!connectionsByMember.has(memberId)) connectionsByMember.set(memberId, new Set());
      const set = connectionsByMember.get(memberId)!;
      for (const other of attendees) {
        if (other !== memberId) set.add(other);
      }
    }
  }

  const slackActivityCounts = new Map<string, number>();
  for (const row of slackActivity) {
    slackActivityCounts.set(row.member_id, (slackActivityCounts.get(row.member_id) ?? 0) + 1);
  }

  const slackUserIdByMember = new Map<string, string>();
  for (const row of slackAliases) {
    slackUserIdByMember.set(row.member_id, row.alias);
  }

  return members.map((m) => ({
    memberId: m.id,
    memberName: m.name,
    photoUrl: m.photo_url,
    slackUserId: slackUserIdByMember.get(m.id) ?? null,
    connectionCount: connectionsByMember.get(m.id)?.size ?? 0,
    recentSlackActivityCount: slackActivityCounts.get(m.id) ?? 0,
  }));
}

export async function spinRoulette(): Promise<RouletteSpinResponse> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return { error: "No member record" };

  const slackToken = process.env.SLACK_BOT_TOKEN;
  if (!slackToken) return { error: "Slack isn't configured for this workspace yet" };

  const pool = await loadCandidatePool(supabase, effectiveIdentity.memberId);
  if (pool.length === 0) return { noOneAvailable: true };

  const slack = new WebClient(slackToken);

  const winner = await pickRouletteMatch(pool, async (candidate) => {
    try {
      const presence = await slack.users.getPresence({ user: candidate.slackUserId! });
      return presence.presence === "active";
    } catch (error) {
      console.error(`Roulette presence check failed for ${candidate.memberName}:`, error);
      return false;
    }
  });

  if (!winner) return { noOneAvailable: true };

  let dmUrl = "https://quillandcup.slack.com";
  try {
    const auth = await slack.auth.test();
    if (auth.team_id) {
      dmUrl = `slack://user?team=${auth.team_id}&id=${winner.slackUserId}`;
    }
  } catch (error) {
    console.error("Roulette: failed to resolve Slack team ID for DM link:", error);
  }

  const reel = buildReel(winner, pool, REEL_SLOT_COUNT).map((c) => ({
    memberId: c.memberId,
    memberName: c.memberName,
    photoUrl: c.photoUrl,
  }));

  return {
    winner: {
      memberId: winner.memberId,
      memberName: winner.memberName,
      photoUrl: winner.photoUrl,
      dmUrl,
    },
    reel,
  };
}
