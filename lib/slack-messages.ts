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

/**
 * Limits for /api/import/slack-api. An object rather than constants so tests
 * can lower them without faking timers or Date.now, which would also fire
 * the HTTP client's own timeouts on in-flight Supabase requests.
 */
export const slackImportLimits = {
  // Thread replies get whatever is left of this after channel history,
  // leaving the rest of the 300s maxDuration for the upserts and Silver
  // reprocessing. Threads that don't fit are fetched on the next run.
  fetchBudgetMs: 170_000,
  // Replies to threads active this recently are refetched every run, to
  // catch reactions added or removed on them.
  recentThreadDays: 3,
};

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
 * Threads whose replies the import should fetch this run, newest activity first.
 *
 * One conversations.replies call per thread across 90 days (600+) runs into
 * Slack's rate limit and the 300s function limit, so only threads that need
 * it are fetched:
 *  - Slack reports more or newer replies than we have stored (new or missed
 *    replies). Because this compares against the replies actually stored, a
 *    thread deferred by the time budget is still "behind" on the next run.
 *  - The thread had a reply within `recentSince`: replies there can still
 *    gain or lose reactions, which don't change reply_count/latest_reply.
 * Edits and deletes of older replies arrive through the webhook.
 */
export function threadsNeedingReplies<T extends SlackThreadParent>(
  parents: T[],
  stored: Map<string, StoredThreadReplies>,
  recentSince: number
): T[] {
  const latestReply = (p: T) => parseFloat(p.raw_payload?.latest_reply ?? p.message_ts);
  return parents
    .filter((p) => {
      if (!(p.reply_count > 0)) return false;
      const have = stored.get(threadKey(p.channel_id, p.message_ts));
      if (!have || have.count < p.reply_count) return true;
      const latest = p.raw_payload?.latest_reply;
      if (latest && (!have.latestTs || parseFloat(have.latestTs) < parseFloat(latest))) return true;
      return latestReply(p) >= recentSince;
    })
    .sort((a, b) => latestReply(b) - latestReply(a));
}

export function threadKey(channelId: string, threadTs: string): string {
  return `${channelId}|${threadTs}`;
}
