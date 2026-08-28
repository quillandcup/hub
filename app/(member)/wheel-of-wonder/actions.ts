"use server";

import { WebClient } from "@slack/web-api";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";
import { matchSlackUsersToMembers } from "@/lib/slack-matching";
import { pickConversationStarter } from "@/lib/roulette-starters";
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
  /** True if the bot created a 3-person room and already posted the icebreaker into it. */
  roomCreated: boolean;
  /** Set only when roomCreated is false — an icebreaker the client should offer to copy next to the DM link. */
  starterText: string | null;
}

export interface RouletteSpinResult {
  winner: RouletteWinner;
  reel: { memberId: string; memberName: string; photoUrl: string | null }[];
}

export type RouletteSpinResponse =
  | RouletteSpinResult
  | { error: string }
  | { noOneAvailable: true };

interface CandidatePoolResult {
  pool: RouletteCandidate[];
  /** The spinner's own Slack user ID, resolved the same way candidates are — null if unmatched. */
  viewerSlackUserId: string | null;
}

async function loadCandidatePool(
  supabase: SupabaseClient,
  viewerMemberId: string
): Promise<CandidatePoolResult> {
  const activityWindowStart = new Date(
    Date.now() - SLACK_ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const [membersResult, allMembersForMatching, attendance, slackActivity, slackAliases, slackUsers] =
    await Promise.all([
      supabase
        .from("members")
        .select("id, name, photo_url")
        .eq("status", "active")
        .neq("id", viewerMemberId),
      // matchSlackUsersToMembers needs the full member roster (with email) to
      // resolve email/name matches, not just the id/photo fields above.
      supabase.from("members").select("id, name, email"),
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
      fetchAllPaginated<{ member_id: string; alias: string; source: "zoom" | "slack" }>((offset) =>
        supabase
          .from("member_name_aliases")
          .select("member_id, alias, source")
          .range(offset, offset + BATCH_SIZE - 1)
      ),
      supabase.schema("bronze").from("slack_users").select("user_id, email, real_name"),
    ]);

  const members = membersResult.data ?? [];

  // Same matching logic the Slack data-hygiene pages use (alias > email >
  // normalized name), not just a raw alias lookup — otherwise a member
  // matched automatically by email (the common case) would look unreachable
  // here even though /admin/hygiene considers them linked.
  const slackUserToMemberId = await matchSlackUsersToMembers(
    slackUsers.data ?? [],
    allMembersForMatching.data ?? [],
    slackAliases
  );
  const slackUserIdByMember = new Map<string, string>();
  for (const [slackUserId, memberId] of slackUserToMemberId) {
    slackUserIdByMember.set(memberId, slackUserId);
  }

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

  const pool = members.map((m) => ({
    memberId: m.id,
    memberName: m.name,
    photoUrl: m.photo_url,
    slackUserId: slackUserIdByMember.get(m.id) ?? null,
    connectionCount: connectionsByMember.get(m.id)?.size ?? 0,
    recentSlackActivityCount: slackActivityCounts.get(m.id) ?? 0,
  }));

  return {
    pool,
    // allMembersForMatching (unlike the pool source) still includes the
    // viewer, so their own Slack user ID is resolvable from the same map
    // before it gets filtered down to candidates.
    viewerSlackUserId: slackUserIdByMember.get(viewerMemberId) ?? null,
  };
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

  const { pool, viewerSlackUserId } = await loadCandidatePool(supabase, effectiveIdentity.memberId);
  if (pool.length === 0) return { noOneAvailable: true };

  const slack = new WebClient(slackToken);

  const winner = await pickRouletteMatch(
    pool,
    async (candidate) => {
      try {
        const presence = await slack.users.getPresence({ user: candidate.slackUserId! });
        return presence.presence === "active";
      } catch (error) {
        console.error(`Roulette presence check failed for ${candidate.memberName}:`, error);
        return false;
      }
    },
    // The weighting deliberately favors low-connection/low-activity members,
    // which also skews toward people less likely to be online right now. A
    // small attempt cap meant we could give up while someone reachable sat
    // untried further down the list — the presence check is what actually
    // guarantees a live match, so try the whole eligible pool before
    // reporting nobody's around.
    { maxAttempts: pool.length }
  );

  if (!winner) return { noOneAvailable: true };

  let dmUrl = "https://quillandcup.slack.com";
  let teamId: string | undefined;
  try {
    const auth = await slack.auth.test();
    teamId = auth.team_id;
    if (teamId) {
      dmUrl = `slack://user?team=${teamId}&id=${winner.slackUserId}`;
    }
  } catch (error) {
    console.error("Roulette: failed to resolve Slack team ID for DM link:", error);
  }

  // Prefer a pre-seeded 3-person room (spinner + winner + bot) over a bare
  // 1:1 DM link so the match isn't two strangers staring at a blank
  // conversation, and so a real reply can be detected as a confirmed
  // connection via the Slack Events webhook (app/api/webhooks/slack/route.ts).
  // Any failure here (missing scope, rate limit, etc.) must never break the
  // core roulette experience -- silently fall back to the plain DM link.
  let roomCreated = false;
  if (teamId && viewerSlackUserId && winner.slackUserId) {
    try {
      const conversation = await slack.conversations.open({
        users: [viewerSlackUserId, winner.slackUserId].join(","),
      });
      const channelId = conversation.channel?.id;
      if (!channelId) throw new Error("conversations.open returned no channel id");

      const starter = pickConversationStarter();
      await slack.chat.postMessage({
        channel: channelId,
        text: `👋 Hey you two — the Wheel of Wonder brought you together! I wonder… ${starter}`,
      });

      const { error: insertError } = await supabase.from("roulette_matches").insert({
        spinner_member_id: effectiveIdentity.memberId,
        matched_member_id: winner.memberId,
        slack_channel_id: channelId,
        status: "proposed",
      });
      if (insertError) throw insertError;

      dmUrl = `slack://channel?team=${teamId}&id=${channelId}`;
      roomCreated = true;
    } catch (error) {
      console.error("Roulette: failed to create match room, falling back to 1:1 DM link:", error);
    }
  }

  // Slack gives us no way to pre-fill text into a bare DM compose box, so
  // when we couldn't create (or didn't attempt) the shared room, hand the
  // client an icebreaker to show as copyable text next to the DM link
  // instead of leaving the member facing a blank conversation.
  const starterText = roomCreated ? null : pickConversationStarter();

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
      roomCreated,
      starterText,
    },
    reel,
  };
}
