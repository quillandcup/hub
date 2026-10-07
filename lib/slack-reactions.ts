import type { SupabaseClient } from "@supabase/supabase-js";

interface MessageKey {
  channel_id: string;
  message_ts: string;
}

interface ReactionKey extends MessageKey {
  reaction: string;
  user_id: string;
}

const TS_CHUNK_SIZE = 100;
const PAGE_SIZE = 1000;
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

  const stale: ReactionKey[] = [];
  for (const [channelId, timestamps] of tsByChannel) {
    for (let i = 0; i < timestamps.length; i += TS_CHUNK_SIZE) {
      const tsChunk = timestamps.slice(i, i + TS_CHUNK_SIZE);
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const { data: batch, error } = await supabase
          .schema("bronze")
          .from("slack_reactions")
          .select("channel_id, message_ts, reaction, user_id")
          .eq("channel_id", channelId)
          .in("message_ts", tsChunk)
          .is("deleted_at", null)
          .order("message_ts")
          .order("reaction")
          .order("user_id")
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;

        for (const r of (batch ?? []) as ReactionKey[]) {
          if (!current.has(reactionKey(r))) stale.push(r);
        }
        offset += batch?.length ?? 0;
        hasMore = (batch?.length ?? 0) === PAGE_SIZE;
      }
    }
  }

  for (let i = 0; i < stale.length; i += DELETE_CONCURRENCY) {
    const results = await Promise.all(
      stale.slice(i, i + DELETE_CONCURRENCY).map((r) =>
        supabase
          .schema("bronze")
          .from("slack_reactions")
          .update({ deleted_at: removedAt })
          .eq("channel_id", r.channel_id)
          .eq("message_ts", r.message_ts)
          .eq("reaction", r.reaction)
          .eq("user_id", r.user_id)
          .is("deleted_at", null)
      )
    );
    const failed = results.find((res) => res.error);
    if (failed?.error) throw failed.error;
  }

  return stale.length;
}
