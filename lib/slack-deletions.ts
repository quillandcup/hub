/**
 * Working out which stored Slack messages were deleted in Slack, from what an
 * import run fetched.
 *
 * The Hub keeps Slack messages for good, and Slack does not: on the free plan
 * its API stops returning a message after about 90 days and Slack deletes it
 * after a year. So "Slack no longer returns it" only means "deleted" when all
 * of these hold, and otherwise the stored message is left exactly as it is:
 *
 *  - The message is recent enough that Slack would certainly still return it
 *    (DELETION_INFERENCE_MAX_AGE_DAYS, well inside the history limit), and
 *    inside the range this run asked for.
 *  - It is old enough that the fetch can't simply have run before it arrived
 *    (DELETION_INFERENCE_MIN_AGE_MS): the webhook stores messages at once.
 *  - Its conversation was fetched completely in this run: the channel's
 *    history for a top-level message, the thread's replies for a reply.
 *  - Not too many of a channel's messages went missing at once (see
 *    suspiciousDeletionCount). A sudden mass disappearance is far more likely
 *    to be Slack changing what it returns than members deleting messages.
 *
 * Deletions are soft (deleted_at). If a message marked deleted shows up in a
 * later fetch, the import's upsert clears it again.
 */

/** Slack's free plan serves about this many days of history. */
export const SLACK_HISTORY_LIMIT_DAYS = 90;
/** Absence only counts as deletion for messages newer than this. */
export const DELETION_INFERENCE_MAX_AGE_DAYS = 80;
/** ...and older than this. */
export const DELETION_INFERENCE_MIN_AGE_MS = 15 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export const slackThreadKey = (channelId: string, threadTs: string) => `${channelId}|${threadTs}`;

/**
 * The span of time in which a missing message can be called deleted, or null
 * if this run's range leaves none. `oldestSec`/`latestSec` are what the run
 * passed to conversations.history.
 */
export function deletionInferenceWindow(
  oldestSec: number,
  latestSec: number,
  nowMs: number
): { from: string; to: string } | null {
  // A minute in from the range's own edge, so rounding at the boundary can't matter.
  const from = Math.max(oldestSec * 1000 + 60_000, nowMs - DELETION_INFERENCE_MAX_AGE_DAYS * DAY_MS);
  const to = latestSec * 1000 - DELETION_INFERENCE_MIN_AGE_MS;
  if (from >= to) return null;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

export interface StoredSlackMessage {
  channel_id: string;
  message_ts: string;
  thread_ts: string | null;
  occurred_at: string;
}

/** Everything Slack returned in this run, including messages the import doesn't keep. */
export interface SeenInSlack {
  /** Per channel whose history was fetched completely: the ts of every top-level message returned. */
  topLevelByChannel: Map<string, Set<string>>;
  /** Per thread whose replies are known completely (slackThreadKey): the ts of every reply returned. */
  repliesByThread: Map<string, Set<string>>;
}

/**
 * Stored, not-yet-deleted messages that Slack should have returned and didn't.
 * `stored` may hold any messages; only those the rules above allow are judged.
 */
export function messagesMissingFromSlack<T extends StoredSlackMessage>(
  stored: T[],
  seen: SeenInSlack,
  window: { from: string; to: string } | null
): T[] {
  if (!window) return [];
  const fromMs = Date.parse(window.from);
  const toMs = Date.parse(window.to);

  return stored.filter((m) => {
    const at = Date.parse(m.occurred_at);
    if (!(at >= fromMs && at <= toMs)) return false;

    const isReply = !!m.thread_ts && m.thread_ts !== m.message_ts;
    const returned = isReply
      ? seen.repliesByThread.get(slackThreadKey(m.channel_id, m.thread_ts as string))
      : seen.topLevelByChannel.get(m.channel_id);
    // Conversation not fetched (completely) this run: no verdict.
    if (!returned) return false;
    return !returned.has(m.message_ts);
  });
}

/**
 * Whether `missing` of a channel's `judged` messages disappearing in one run is
 * too many to believe. Small numbers are always fine: a member tidying up a
 * handful of their own messages is normal.
 */
export function isSuspiciousDeletionCount(missing: number, judged: number): boolean {
  if (missing <= 10) return false;
  return missing > judged * 0.25;
}

/** A delete event for a message this old can't be a member deleting it: Slack no longer shows it to anyone. */
export function isBeyondSlackHistory(messageTs: string, nowMs: number): boolean {
  const at = parseFloat(messageTs) * 1000;
  return Number.isFinite(at) && nowMs - at > SLACK_HISTORY_LIMIT_DAYS * DAY_MS;
}

// ---------------------------------------------------------------------------
// Applying it
// ---------------------------------------------------------------------------

export interface DeletionResult {
  /** Stored messages that got a verdict (their conversation was fetched and they're inside the window). */
  judged: number;
  /** Newly marked deleted_at. */
  deleted: number;
  /** Channels where too many messages went missing at once; nothing was marked there. */
  suspiciousChannels: { channel_id: string; missing: number; judged: number }[];
}

const PAGE_SIZE = 1000;
const TS_CHUNK_SIZE = 100;

/**
 * Soft-delete stored messages that this import run shows were deleted in Slack.
 * `supabase` only needs to read and update bronze.slack_messages.
 */
export async function markMessagesDeletedInSlack(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  seen: SeenInSlack,
  window: { from: string; to: string } | null,
  deletedAt: string
): Promise<DeletionResult> {
  const result: DeletionResult = { judged: 0, deleted: 0, suspiciousChannels: [] };
  if (!window || seen.topLevelByChannel.size === 0) return result;

  const stored: StoredSlackMessage[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .schema("bronze")
      .from("slack_messages")
      .select("channel_id, message_ts, thread_ts, occurred_at")
      .gte("occurred_at", window.from)
      .lte("occurred_at", window.to)
      .is("deleted_at", null)
      .order("channel_id")
      .order("message_ts")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    stored.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  // Count verdicts per channel by judging everything against "nothing was
  // returned": whatever that flags is exactly the set that gets a verdict.
  const judgedByChannel = new Map<string, number>();
  const emptySeen: SeenInSlack = {
    topLevelByChannel: new Map([...seen.topLevelByChannel.keys()].map((id) => [id, new Set<string>()])),
    repliesByThread: new Map([...seen.repliesByThread.keys()].map((key) => [key, new Set<string>()])),
  };
  for (const m of messagesMissingFromSlack(stored, emptySeen, window)) {
    judgedByChannel.set(m.channel_id, (judgedByChannel.get(m.channel_id) ?? 0) + 1);
    result.judged++;
  }

  const missingByChannel = new Map<string, string[]>();
  for (const m of messagesMissingFromSlack(stored, seen, window)) {
    const list = missingByChannel.get(m.channel_id) ?? [];
    list.push(m.message_ts);
    missingByChannel.set(m.channel_id, list);
  }

  for (const [channelId, timestamps] of missingByChannel) {
    const judged = judgedByChannel.get(channelId) ?? 0;
    if (isSuspiciousDeletionCount(timestamps.length, judged)) {
      result.suspiciousChannels.push({ channel_id: channelId, missing: timestamps.length, judged });
      continue;
    }
    for (let i = 0; i < timestamps.length; i += TS_CHUNK_SIZE) {
      const { error } = await supabase
        .schema("bronze")
        .from("slack_messages")
        .update({ deleted_at: deletedAt })
        .eq("channel_id", channelId)
        .in("message_ts", timestamps.slice(i, i + TS_CHUNK_SIZE))
        .is("deleted_at", null);
      if (error) throw error;
    }
    result.deleted += timestamps.length;
  }

  return result;
}
