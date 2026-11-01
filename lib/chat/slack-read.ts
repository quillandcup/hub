import { WebClient } from "@slack/web-api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import { chatSlackWritesEnabled } from "@/lib/chat/slack-post";
import { getSlackUserToken, isDeadTokenError } from "@/lib/slack-connect";

/**
 * Read state shared with Slack (docs/SLACK_BRIDGED_CHAT.md, "Read state shared with Slack"). Only a
 * member's own Slack token can read or set their read marker, so this is for members who connected
 * Slack; everyone else keeps a Hub-only marker. Service role.
 */

/** At most one pull of a member's Slack markers per this many seconds, however many windows ask. */
export const SLACK_READ_PULL_INTERVAL_SECONDS = 30;

/** Conversations asked about at once; conversations.info allows roughly 50 calls a minute. */
const PULL_CONCURRENCY = 5;

/** Slack timestamps are "seconds.microseconds"; compared as integers so no float rounding creeps in. */
const tsValue = (ts: string): bigint | null => {
  const match = /^(\d+)\.(\d+)$/.exec(ts);
  return match ? BigInt(match[1] + match[2].padEnd(6, "0").slice(0, 6)) : null;
};

/** Whether Slack's marker `readTs` already covers `ts` (a never-read conversation reports 0000000000.000000). */
export function slackReadCovers(readTs: string | undefined | null, ts: string): boolean {
  const read = readTs ? tsValue(readTs) : null;
  const target = tsValue(ts);
  return read !== null && target !== null && read >= target;
}

const errorCode = (error: unknown): string | undefined => (error as { data?: { error?: string } } | null)?.data?.error;
const isRateLimited = (error: unknown): boolean => (error as { code?: string } | null)?.code === "slack_webapi_rate_limited_error";

/** A member's own client, failing fast on a rate limit instead of sleeping inside a server action. */
const userClient = (token: string) => new WebClient(token, { rejectRateLimitedCalls: true, retryConfig: { retries: 0 } });

/**
 * The member has read a conversation in the Hub through `through` (a message's created_at): move
 * their Slack marker to the newest message at or before it, so Slack stops showing it as unread.
 * Never moves Slack's marker backward (they may have read further there), and does nothing for a
 * member without a working connection or the user scopes (they reconnect from Settings), outside
 * production, or for a conversation Slack doesn't know them in. Returns whether Slack was updated.
 */
export async function pushReadToSlack(
  service: SupabaseClient,
  opts: { memberId: string; channelId: string; through: string }
): Promise<boolean> {
  if (!chatSlackWritesEnabled()) return false;

  // A failed read of either counts as "nothing to move", as it always has.
  const chat = createRepos(service).chat;
  const [slackChannelId, ts] = await Promise.all([
    chat.channelRecord(opts.channelId).then((c) => c?.slack_channel_id ?? null).catch(() => null),
    chat.newestSlackTs(opts.channelId, opts.through).catch(() => null),
  ]);
  if (!slackChannelId || !ts) return false;

  const connection = await getSlackUserToken(service, opts.memberId);
  if (!connection) return false;

  const slack = userClient(connection.token);
  try {
    const info = await slack.conversations.info({ channel: slackChannelId });
    if (slackReadCovers(info.channel?.last_read, ts)) return false;
    await slack.conversations.mark({ channel: slackChannelId, ts });
    return true;
  } catch (error) {
    if (isDeadTokenError(error)) await service.rpc("slack_connection_revoke", { p_member: opts.memberId });
    // Connected before read sync existed (no scope yet), or not in the channel in Slack: nothing to do.
    else if (!["missing_scope", "not_in_channel", "channel_not_found"].includes(errorCode(error) ?? "") && !isRateLimited(error)) {
      console.error("pushReadToSlack failed for member %s:", opts.memberId, error);
    }
    return false;
  }
}

/**
 * Bring the member's Hub read markers up to what they have read in Slack: for each bridged
 * conversation they are in that has unread in the Hub (newest first), read Slack's `last_read` with
 * their own token and move the Hub marker forward (never backward). Slack has no push event for this, so it runs when the member comes back
 * to the Hub. `exceptChannelId` is the conversation open right now: its marker is left alone so the
 * "New" line on screen doesn't jump. Throttled per member; returns false when nothing was pulled
 * (throttled, not connected, or the connection is unusable), true when the markers were checked.
 */
export async function pullReadFromSlack(
  service: SupabaseClient,
  memberId: string,
  opts: { exceptChannelId?: string | null } = {}
): Promise<boolean> {
  const { data: claimed } = await service.rpc("chat_claim_slack_read_pull", {
    p_member: memberId,
    p_min_seconds: SLACK_READ_PULL_INTERVAL_SECONDS,
  });
  if (!claimed) return false;

  const connection = await getSlackUserToken(service, memberId);
  if (!connection) return false;

  // A failed read means no conversations to ask about, as it always has.
  const memberships = await createRepos(service).chat.slackReadTargets(memberId).catch(() => []);
  const targets: { channelId: string; slackChannelId: string }[] = [];
  for (const m of memberships) {
    if (!m.slackChannelId || m.archivedAt || m.bridgeDisabled) continue;
    if (m.channelId === opts.exceptChannelId) continue;
    targets.push({ channelId: m.channelId, slackChannelId: m.slackChannelId });
  }

  // Slack's marker can only matter where the Hub still shows unread (the Hub marker only moves
  // forward), so ask about those, most recent first: a few calls instead of one per conversation,
  // and the badges that matter clear first. If the list can't be read, ask about all of them.
  const { data: unread, error: unreadError } = await service.rpc("chat_unread_channel_ids", { p_member: memberId });
  if (unreadError) console.error("chat_unread_channel_ids failed for member %s:", memberId, unreadError.message);
  if (!unreadError && Array.isArray(unread)) {
    const order = new Map((unread as { channel_id: string }[]).map((row, index) => [row.channel_id, index]));
    const unreadTargets = targets.filter((t) => order.has(t.channelId)).sort((a, b) => order.get(a.channelId)! - order.get(b.channelId)!);
    targets.splice(0, targets.length, ...unreadTargets);
  }

  const slack = userClient(connection.token);
  let stop = false;
  const next = [...targets];
  const worker = async () => {
    for (let target = next.shift(); target && !stop; target = next.shift()) {
      try {
        const info = await slack.conversations.info({ channel: target.slackChannelId });
        const lastRead = info.channel?.last_read;
        const read = lastRead ? tsValue(lastRead) : null;
        if (lastRead === undefined || read === null || read === BigInt(0)) continue; // never read there
        await service.rpc("chat_apply_slack_read", { p_member: memberId, p_channel_id: target.channelId, p_slack_ts: lastRead });
      } catch (error) {
        const code = errorCode(error);
        if (isDeadTokenError(error)) {
          await service.rpc("slack_connection_revoke", { p_member: memberId });
          stop = true;
        } else if (code === "missing_scope" || isRateLimited(error)) {
          stop = true; // every other call would fail the same way
          // Bounded by the per-member throttle above (one pull per SLACK_READ_PULL_INTERVAL_SECONDS).
          console.warn("pullReadFromSlack stopped for member %s: %s", memberId, code ?? "rate limited");
        } else if (code !== "not_in_channel" && code !== "channel_not_found") {
          console.error("pullReadFromSlack failed for member %s:", memberId, error);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PULL_CONCURRENCY, targets.length) }, worker));
  return true;
}
