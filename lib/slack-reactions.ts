import { createRepos } from "@/lib/data/repos";
import type { SupabaseClient } from "@supabase/supabase-js";

interface MessageKey {
  channel_id: string;
  message_ts: string;
}

interface ReactionKey extends MessageKey {
  reaction: string;
  user_id: string;
}

const DELETE_CONCURRENCY = 50;

const reactionKey = (r: ReactionKey) => `${r.channel_id}|${r.message_ts}|${r.reaction}|${r.user_id}`;

/**
 * Mark Bronze reactions that were taken back in Slack (deleted_at: a soft
 * delete, so the history of who reacted is kept).
 *
 * The Slack API import only upserts, so a reaction removed while the
 * `reaction_removed` webhook was down (or rejected) would otherwise live on in
 * bronze.slack_reactions. For every message the import fetched, Slack's
 * `reactions` list is the whole truth, so any stored reaction on that message
 * that isn't in `fetchedReactions` is stale.
 *
 * Scoped to the fetched messages only (top-level messages in the date range
 * and every reply in their threads): reactions on anything else, such as a
 * reply in a thread whose parent predates the range, are left alone. That is
 * also what keeps a message that has aged out of Slack's history untouched:
 * it isn't fetched, so its reactions are never judged.
 *
 * A reaction that comes back is un-removed by the import's upsert (and the
 * webhook's), which write deleted_at: null.
 */
export async function markRemovedSlackReactions(
  supabase: SupabaseClient,
  fetchedMessages: MessageKey[],
  fetchedReactions: ReactionKey[],
  removedAt: string
): Promise<number> {
  const current = new Set(fetchedReactions.map(reactionKey));

  const tsByChannel = new Map<string, string[]>();
  for (const m of fetchedMessages) {
    const list = tsByChannel.get(m.channel_id) ?? [];
    list.push(m.message_ts);
    tsByChannel.set(m.channel_id, list);
  }

  const messages = createRepos(supabase).slackMessages;
  const stale: ReactionKey[] = [];
  for (const [channelId, timestamps] of tsByChannel) {
    for (const r of await messages.liveReactionsOn(channelId, timestamps)) {
      if (!current.has(reactionKey(r))) stale.push(r);
    }
  }

  for (let i = 0; i < stale.length; i += DELETE_CONCURRENCY) {
    await Promise.all(stale.slice(i, i + DELETE_CONCURRENCY).map((r) => messages.markReactionRemoved(r, removedAt)));
  }

  return stale.length;
}
