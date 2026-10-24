"use server";

import { createRepos } from "@/lib/data/repos";
import { WebClient } from "@slack/web-api";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { loadVerifiedSlackLinks, matchSlackUsersToMembers } from "@/lib/slack-matching";
import { pickConversationStarter } from "@/lib/wheel-of-wonder-starters";
import {
  pickWheelMatch,
  buildReel,
  type WheelCandidate,
} from "@/lib/wheel-of-wonder";

import { actionOutcome, withAction } from "@/lib/analytics/server";
const BATCH_SIZE = 1000;
const SLACK_ACTIVITY_WINDOW_DAYS = 45;
const REEL_SLOT_COUNT = 8;


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

export interface WheelWinner {
  memberId: string;
  memberName: string;
  photoUrl: string | null;
}

export interface WheelIntroduction {
  /** Where to send the member: the 3-person room if it was created, else the plain 1:1 DM. */
  url: string;
  /** True if the bot created a 3-person room and posted the icebreaker into it. */
  roomCreated: boolean;
  /** Set only when roomCreated is false: an icebreaker the client should offer to copy. */
  starterText: string | null;
}

export type WheelIntroResponse = WheelIntroduction | { error: string };

export interface WheelSpinResult {
  winner: WheelWinner;
  reel: { memberId: string; memberName: string; photoUrl: string | null }[];
}

export type WheelSpinResponse =
  | WheelSpinResult
  | { error: string }
  | { noOneAvailable: true };

interface CandidatePoolResult {
  pool: WheelCandidate[];
  /** The spinner's own Slack user ID, resolved the same way candidates are — null if unmatched. */
  viewerSlackUserId: string | null;
}

/**
 * Builds the candidate pool from community-wide data a member session can't read under RLS
 * (other members' emails and status, everyone's Slack activity and aliases, bronze.slack_users),
 * so it runs server-side with the service role. Only the pool's non-sensitive fields (member id,
 * name, photo, Slack user id, derived counts) are used by callers, and only the winner/reel
 * names and photos reach the client.
 */
async function loadCandidatePool(viewerMemberId: string): Promise<CandidatePoolResult> {
  const supabase = createServiceRoleClient();
  const activityWindowStart = new Date(
    Date.now() - SLACK_ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const [membersResult, allMembersForMatching, attendance, slackActivity, slackAliases, slackUsers] =
    await Promise.all([
      createRepos(supabase).members.list({ status: "active" }),
      // matchSlackUsersToMembers needs the full member roster (with email) to
      // resolve email/name matches, not just the id/photo fields above.
      createRepos(supabase).members.identities(),
      createRepos(supabase)
        .attendance.list()
        .then((links) => links.map((l) => ({ member_id: l.memberId, prickle_id: l.prickleId }))),
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
          .eq("active", true)
          .range(offset, offset + BATCH_SIZE - 1)
      ),
      supabase.schema("bronze").from("slack_users").select("user_id, email, real_name"),
    ]);

  const members = membersResult
    .filter((m) => m.id !== viewerMemberId)
    .map((m) => ({ id: m.id, name: m.name, photo_url: m.photoUrl }));

  // Same matching logic the Slack data-hygiene pages use (alias > email >
  // normalized name), not just a raw alias lookup — otherwise a member
  // matched automatically by email (the common case) would look unreachable
  // here even though /admin/hygiene considers them linked.
  const slackUserToMemberId = await matchSlackUsersToMembers(
    slackUsers.data ?? [],
    allMembersForMatching,
    slackAliases,
    await loadVerifiedSlackLinks(supabase)
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

async function spinWheelImpl(): Promise<WheelSpinResponse> {
  const supabase = await createClient();

  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return { error: "No member record" };

  const slackToken = process.env.SLACK_BOT_TOKEN;
  if (!slackToken) return { error: "Slack isn't configured for this workspace yet" };

  const { pool, viewerSlackUserId } = await loadCandidatePool(effectiveIdentity.memberId);
  if (pool.length === 0) return { noOneAvailable: true };

  const slack = new WebClient(slackToken);

  const winner = await pickWheelMatch(
    pool,
    async (candidate) => {
      try {
        const presence = await slack.users.getPresence({ user: candidate.slackUserId! });
        return presence.presence === "active";
      } catch (error) {
        console.error(`Wheel of Wonder presence check failed for ${candidate.memberName}:`, error);
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
    },
    reel,
  };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function spinWheel(...args: Parameters<typeof spinWheelImpl>): ReturnType<typeof spinWheelImpl> {
  return withAction("wheel_spun", () => spinWheelImpl(...args), (result) => ("noOneAvailable" in result ? { ok: true, detail: "nobody" } : actionOutcome(result)));
}

/**
 * Runs only when the member clicks "Message on Slack": spinning just picks a match and posts nothing.
 * Prefers a pre-seeded 3-person room (spinner + winner + bot) over a bare 1:1 DM link so the match
 * isn't two strangers staring at a blank conversation, and so a real reply can be detected as a
 * confirmed connection via the Slack Events webhook (app/api/webhooks/slack/route.ts). Any failure
 * (missing scope, rate limit, etc.) falls back to the plain DM link plus a copyable icebreaker.
 */
async function introduceOnSlackImpl(winnerMemberId: string): Promise<WheelIntroResponse> {
  const supabase = await createClient();

  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return { error: "No member record" };

  const slackToken = process.env.SLACK_BOT_TOKEN;
  if (!slackToken) return { error: "Slack isn't configured for this workspace yet" };

  const { pool, viewerSlackUserId } = await loadCandidatePool(effectiveIdentity.memberId);
  const winner = pool.find((c) => c.memberId === winnerMemberId);
  if (!winner?.slackUserId) return { error: "Couldn't find that member on Slack" };

  const slack = new WebClient(slackToken);

  let url = "https://quillandcup.slack.com";
  let teamId: string | undefined;
  try {
    const auth = await slack.auth.test();
    teamId = auth.team_id;
    if (teamId) {
      url = `slack://user?team=${teamId}&id=${winner.slackUserId}`;
    }
  } catch (error) {
    console.error("Wheel of Wonder: failed to resolve Slack team ID for DM link:", error);
  }

  let roomCreated = false;
  if (teamId && viewerSlackUserId) {
    try {
      const conversation = await slack.conversations.open({
        users: [viewerSlackUserId, winner.slackUserId].join(","),
      });
      const channelId = conversation.channel?.id;
      if (!channelId) throw new Error("conversations.open returned no channel id");

      const starter = pickConversationStarter();
      await slack.chat.postMessage({
        channel: channelId,
        text: `👋 Billie would like to (re)introduce ${effectiveIdentity.memberName} and ${winner.memberName} — the Wheel of Wonder brought you two together! I wonder… ${starter}`,
        unfurl_links: false,
        unfurl_media: false,
      });

      // The room already exists and has the icebreaker in it at this point --
      // point the member there regardless of whether the tracking insert
      // below succeeds, so a DB hiccup can't strand them on the 1:1 DM link
      // while a populated room sits unlinked in the background.
      url = `slack://channel?team=${teamId}&id=${channelId}`;
      roomCreated = true;

      const { error: insertError } = await supabase.from("wheel_of_wonder_matches").insert({
        spinner_member_id: effectiveIdentity.memberId,
        matched_member_id: winner.memberId,
        slack_channel_id: channelId,
        spinner_slack_user_id: viewerSlackUserId,
        matched_slack_user_id: winner.slackUserId,
        status: "proposed",
      });
      if (insertError) throw insertError;
    } catch (error) {
      console.error(
        roomCreated
          ? "Wheel of Wonder: match room created but tracking insert failed (webhook won't detect a confirmed connection for this room):"
          : "Wheel of Wonder: failed to create match room, falling back to 1:1 DM link:",
        error
      );
    }
  }

  // Slack gives us no way to pre-fill text into a bare DM compose box, so
  // when we couldn't create the shared room, hand the client an icebreaker to
  // show as copyable text instead of leaving the member facing a blank conversation.
  return { url, roomCreated, starterText: roomCreated ? null : pickConversationStarter() };
}

export async function introduceOnSlack(
  ...args: Parameters<typeof introduceOnSlackImpl>
): ReturnType<typeof introduceOnSlackImpl> {
  return withAction("wheel_introduced", () => introduceOnSlackImpl(...args), actionOutcome);
}
