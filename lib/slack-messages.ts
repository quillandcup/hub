/**
 * Rules shared by the Slack import (app/api/import/slack-api) and the Events
 * API webhook (app/api/webhooks/slack) for what goes into bronze.slack_messages,
 * so a message looks the same whichever path stored it.
 */

/**
 * Notices Slack posts itself when someone changes a channel ("Ania renamed the channel from X to Y").
 * Kept so the Hub chat shows them, but they are not something a member wrote: activity, engagement
 * and the Wheel of Wonder leave them out. The same list is in chat_messages' system_subtype trigger
 * (20261203000000_chat_system_messages.sql).
 */
export const SLACK_SYSTEM_SUBTYPES = [
  'channel_name',
  'channel_topic',
  'channel_purpose',
  'channel_archive',
  'channel_unarchive',
  'group_name',
  'group_topic',
  'group_purpose',
  'group_archive',
  'group_unarchive',
] as const

const SYSTEM_SUBTYPES = new Set<string>(SLACK_SYSTEM_SUBTYPES)

export function isSlackSystemMessage(msg: { subtype?: string }): boolean {
  return !!msg.subtype && SYSTEM_SUBTYPES.has(msg.subtype)
}

/** Plain messages (no subtype), these subtypes and channel-change notices are kept; joins, leaves etc. are not. */
const KEPT_SUBTYPES = new Set(['file_share', 'thread_broadcast'])

export function isKeptSlackMessage(msg: { subtype?: string }): boolean {
  return !msg.subtype || KEPT_SUBTYPES.has(msg.subtype) || isSlackSystemMessage(msg)
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
 * Edits of older replies arrive through the webhook.
 */
/** Slack's replies for this thread differ from the live ones we have stored: more, newer, or fewer (one was deleted). */
export function isThreadBehind(p: SlackThreadParent, stored: Map<string, StoredThreadReplies>): boolean {
  if (!(p.reply_count > 0)) return false;
  const have = stored.get(threadKey(p.channel_id, p.message_ts));
  const latest = p.raw_payload?.latest_reply;
  return (
    !have ||
    // Fewer: replies we don't have yet. More: a reply was deleted in Slack and
    // we still hold it as live; fetching the thread lets the import mark it
    // (lib/slack-deletions.ts). `count` is of replies not already marked deleted.
    have.count !== p.reply_count ||
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

/**
 * Whether a Slack import changed anything members are built from. Member
 * processing reads only email and image_url (avatar) from bronze.slack_users,
 * so an import that changed neither for any user, and added or removed no one,
 * doesn't need to rebuild members (or the 90-day attendance rebuild that
 * follows a member change).
 */
export function slackUsersChangedForMembers(
  stored: { user_id: string; email: string | null; image_url: string | null }[],
  fetched: { user_id: string; email: string | null; image_url: string | null }[]
): boolean {
  const key = (u: { email: string | null; image_url: string | null }) => `${u.email ?? ""}\u0000${u.image_url ?? ""}`;
  const before = new Map(stored.map((u) => [u.user_id, key(u)]));
  // A removed user leaves its bronze row in place (the import only upserts),
  // so only additions and changes can alter what members read.
  return fetched.some((u) => before.get(u.user_id) !== key(u));
}

/**
 * One Slack message as the Bronze rows it becomes: the message (unless it is a join, leave or other
 * notice) and one row per reaction user. Shared by the import and the chat's gap-fill, so a message
 * looks the same whichever path stored it. User email and name are filled in by the caller.
 */
export function addSlackMessage(
  msg: any,
  channelId: string,
  channelName: string,
  channelType: string,
  messages: any[],
  reactions: any[]
) {
  // Skip join/leave messages (keep file_share, thread_broadcast)
  if (!isKeptSlackMessage(msg)) {
    return;
  }

  messages.push({
    message_ts: msg.ts,
    channel_id: channelId,
    channel_name: channelName,
    channel_type: channelType,
    user_id: slackMessageUserId(msg),
    user_email: '', // Will be filled from users map later
    user_name: '', // Will be filled from users map later
    text: msg.text || '',
    message_type: msg.subtype || 'message',
    thread_ts: msg.thread_ts || null,
    reply_count: msg.reply_count || 0,
    reply_users_count: msg.reply_users_count || 0,
    occurred_at: slackTsToIso(msg.ts),
    edited_at: msg.edited ? new Date(msg.edited.ts * 1000).toISOString() : null,
    deleted_at: null,
    files: msg.files ? msg.files : null,
    raw_payload: msg
  });

  // Extract reactions
  if (msg.reactions) {
    for (const reaction of msg.reactions) {
      for (const userId of reaction.users) {
        reactions.push({
          message_ts: msg.ts,
          channel_id: channelId,
          channel_name: channelName,
          reaction: reaction.name,
          user_id: userId,
          user_email: '', // Will be filled later
          user_name: '', // Will be filled later
          occurred_at: new Date(parseFloat(msg.ts) * 1000).toISOString(),
          deleted_at: null,
          raw_payload: reaction
        });
      }
    }
  }
}
