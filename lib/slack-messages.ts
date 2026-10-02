/**
 * Rules shared by the Slack import (app/api/import/slack-api) and the Events
 * API webhook (app/api/webhooks/slack) for what goes into bronze.slack_messages,
 * so a message looks the same whichever path stored it.
 */

/** Plain messages (no subtype) plus these subtypes are kept; joins, leaves, topic changes etc. are not. */
const KEPT_SUBTYPES = new Set(["file_share", "thread_broadcast"]);

export function isKeptSlackMessage(msg: { subtype?: string }): boolean {
  return !msg.subtype || KEPT_SUBTYPES.has(msg.subtype);
}

/**
 * slack_messages.user_id is NOT NULL. App and bot posts carry a bot_id
 * instead of a user.
 */
export function slackMessageUserId(msg: { user?: string; bot_id?: string }): string {
  return msg.user || msg.bot_id || "unknown";
}

export function slackTsToIso(ts: string | number): string {
  return new Date(parseFloat(String(ts)) * 1000).toISOString();
}

export interface SlackThreadParent {
  channel_id: string;
  message_ts: string;
  reply_count: number;
  raw_payload: { latest_reply?: string };
}

export interface StoredThreadReplies {
  count: number;
  /** Newest stored reply ts in the thread. */
  latestTs: string | null;
}

/**
 * Threads whose replies the import should fetch this run, in the order to fetch them.
 *
 * One conversations.replies call per thread across 90 days (600+) runs into
 * Slack's rate limit and the 300s function limit, so only threads that need
 * it are fetched:
 *  - Behind: Slack reports more or newer replies than we have stored (new or
 *    missed replies). Because this compares against the replies actually
 *    stored, a thread deferred by the time budget is still behind on the next
 *    run; nothing else tracks it. Oldest thread first: on Slack's free plan,
 *    history older than 90 days is gone, so the oldest threads are the ones a
 *    backlog would otherwise lose for good.
 *  - Recent: the thread had a reply within `recentSince`, so replies there can
 *    still gain or lose reactions, which don't change reply_count or
 *    latest_reply. Fetched after every behind thread, newest activity first,
 *    since missing one only delays a reaction until the next run.
 * Edits and deletes of older replies arrive through the webhook.
 */
/** Slack reports more or newer replies than we have stored for this thread. */
export function isThreadBehind(p: SlackThreadParent, stored: Map<string, StoredThreadReplies>): boolean {
  if (!(p.reply_count > 0)) return false;
  const have = stored.get(threadKey(p.channel_id, p.message_ts));
  const latest = p.raw_payload?.latest_reply;
  return (
    !have ||
    have.count < p.reply_count ||
    (!!latest && (!have.latestTs || parseFloat(have.latestTs) < parseFloat(latest)))
  );
}

export function threadsNeedingReplies<T extends SlackThreadParent>(
  parents: T[],
  stored: Map<string, StoredThreadReplies>,
  recentSince: number
): T[] {
  const latestReply = (p: T) => parseFloat(p.raw_payload?.latest_reply ?? p.message_ts);
  const behind: T[] = [];
  const recent: T[] = [];
  for (const p of parents) {
    if (!(p.reply_count > 0)) continue;
    if (isThreadBehind(p, stored)) {
      behind.push(p);
    } else if (latestReply(p) >= recentSince) {
      recent.push(p);
    }
  }
  behind.sort((a, b) => parseFloat(a.message_ts) - parseFloat(b.message_ts));
  recent.sort((a, b) => latestReply(b) - latestReply(a));
  return [...behind, ...recent];
}

export function threadKey(channelId: string, threadTs: string): string {
  return `${channelId}|${threadTs}`;
}
