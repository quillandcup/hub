import { WebClient } from "@slack/web-api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import { chatSlackWritesEnabled } from "@/lib/chat/slack-post";
import { projectChatMessage } from "@/lib/chat-projection";
import { clock } from "@/lib/clock";
import { slackChannelType } from "@/lib/slack-capture";
import { markRemovedSlackReactions } from "@/lib/slack-reactions";
import { addSlackMessage } from "@/lib/slack-messages";
import { getSlackBotToken } from "@/lib/slack-bot-token";

/**
 * Gap-fill (docs/SLACK_BRIDGED_CHAT.md, "Gap-fill"): when the chat is missing something Slack has,
 * fetch it from Slack on the spot and store it exactly as the import would (Bronze, then the chat
 * projection) instead of waiting for the nightly import. Three scopes:
 *
 * - `message`: one message the webhook told us about but we never stored (a reaction or edit on it),
 *   and its thread root if that is missing too;
 * - `thread`: a whole thread (a reply arrived whose root we don't have);
 * - `channel`: the last few hours of a conversation (or everything newer than our newest message, if
 *   that is further back), when someone opens it.
 *
 * Every fill is claimed first (`claim_chat_gap_fill`, at most one per channel/scope/message per
 * interval, so a burst of events or a crowd opening a conversation is one fetch) and recorded
 * (`chat_gap_fills`, shown on /admin/data-health/gap-fills): a fill that recovers a lot means the
 * webhook was down. Reads from Slack and writes our own tables; only the production deploy does it,
 * like every other thing that talks to the real workspace. Service role.
 */

export type GapFillSource = "webhook" | "open" | "manual";

export interface GapFillResult {
  /** False when nothing was done: not production, not a mirrored conversation, or another fill has it covered. */
  claimed: boolean;
  /** Messages and reactions that were new to us. */
  messages: number;
  reactions: number;
  /** Messages Slack returned, new or not: told apart from "nothing came back" by this. */
  seen: number;
  error?: string;
}

const NOT_DONE: GapFillResult = { claimed: false, messages: 0, reactions: 0, seen: 0 };

/** The same fill isn't started twice inside this: a burst of events becomes one fetch. */
const CLAIM_INTERVAL = "1 minute";
/** A catch-up on open stops here; the import fetches the rest. */
const MAX_CATCH_UP_MESSAGES = 100;
const MAX_CATCH_UP_THREADS = 10;
const MAX_THREAD_REPLIES = 500;
/**
 * A catch-up looks at least this far back, not just past the newest message we have: a message the
 * webhook missed that is older than one it did deliver would otherwise never be looked for. What is
 * already stored is just upserted again.
 */
const CATCH_UP_LOOKBACK_SECONDS = 6 * 60 * 60;
/** With nothing stored for a conversation, look this far back. */
const FIRST_CATCH_UP_WINDOW_SECONDS = 24 * 60 * 60;
const PROJECT_CONCURRENCY = 10;

interface MirroredChannel {
  name: string;
  type: string;
}

/** The conversation, if the chat mirrors it. */
async function mirroredChannel(service: SupabaseClient, slackChannelId: string): Promise<MirroredChannel | null> {
  // A failed lookup reads as "not mirrored" (nothing is filled), as it always has.
  const data = await createRepos(service).chat.mirroredChannel(slackChannelId).catch((error: Error) => {
    console.error("looking up the mirrored channel %s failed:", slackChannelId, error.message);
    return null;
  });
  if (!data || data.bridge_disabled) return null;
  const isMpim = data.kind === "group_dm";
  return { name: data.name ?? "", type: slackChannelType({ is_private: data.visibility === "private", is_mpim: isMpim }) };
}

async function claim(
  service: SupabaseClient,
  source: GapFillSource,
  scope: "message" | "thread" | "channel",
  slackChannelId: string,
  ts: string | null
): Promise<string | null> {
  const { data, error } = await service.rpc("claim_chat_gap_fill", {
    p_source: source,
    p_scope: scope,
    p_channel: slackChannelId,
    p_ts: ts,
    p_min_interval: CLAIM_INTERVAL,
  });
  if (error) {
    console.error("claim_chat_gap_fill failed:", error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

async function finish(service: SupabaseClient, id: string, result: { messages: number; reactions: number; seen: number; error?: string }) {
  try {
    await createRepos(service).chat.finishGapFill(id, {
      finishedAt: new Date(clock.now()).toISOString(),
      messagesRecovered: result.messages,
      reactionsRecovered: result.reactions,
      messagesSeen: result.seen,
      error: result.error ?? null,
    });
  } catch (error) {
    console.error("recording a gap-fill failed:", (error as Error).message);
  }
}

type SlackMsg = Record<string, any>;

/**
 * Store what Slack returned: Bronze first (idempotent upserts, like the import), then the chat
 * projection for every message touched. Returns how many messages and reactions were new to us.
 */
async function storeAndProject(
  service: SupabaseClient,
  slackChannelId: string,
  channel: MirroredChannel,
  slackMessages: SlackMsg[]
): Promise<{ messages: number; reactions: number; seen: number }> {
  const messages: any[] = [];
  const reactions: any[] = [];
  for (const msg of slackMessages) addSlackMessage(msg, slackChannelId, channel.name, channel.type, messages, reactions);
  if (messages.length === 0) return { messages: 0, reactions: 0, seen: 0 };

  // A thread_broadcast reply can come back twice (history and thread); one upsert can't touch a row twice.
  const uniqueMessages = [...new Map(messages.map((m) => [m.message_ts, m])).values()];
  const uniqueReactions = [...new Map(reactions.map((r) => [`${r.message_ts}|${r.reaction}|${r.user_id}`, r])).values()];

  // Who is who, as the import fills it in.
  const userIds = [...new Set([...uniqueMessages.map((m) => m.user_id), ...uniqueReactions.map((r) => r.user_id)])];
  const users = await createRepos(service).slackUsers.byIds(userIds);
  const byId = new Map(users.map((u) => [u.user_id, u]));
  for (const row of [...uniqueMessages, ...uniqueReactions]) {
    const user = byId.get(row.user_id);
    if (user) {
      row.user_email = user.email || "";
      row.user_name = user.real_name || user.name || "";
    }
  }

  // What was new to us (the count a recovery is judged by).
  const timestamps = uniqueMessages.map((m) => m.message_ts as string);
  const bronze = createRepos(service).slackMessages;
  const [knownMessages, haveReactions] = await Promise.all([bronze.storedTimestamps(slackChannelId, timestamps), bronze.liveReactionsOn(slackChannelId, timestamps)]);
  const knownReactions = new Set(haveReactions.map((r) => `${r.message_ts}|${r.reaction}|${r.user_id}`));
  const newMessages = uniqueMessages.filter((m) => !knownMessages.has(m.message_ts)).length;
  const newReactions = uniqueReactions.filter((r) => !knownReactions.has(`${r.message_ts}|${r.reaction}|${r.user_id}`)).length;

  const importedAt = new Date(clock.now()).toISOString();
  await bronze.upsertMessages(uniqueMessages.map((m) => ({ ...m, imported_at: importedAt })));
  await bronze.upsertReactions(uniqueReactions.map((r) => ({ ...r, imported_at: importedAt })));

  // Slack's list is the whole truth for a message it returned, so a stored reaction missing from it was
  // taken back. Only judged where Slack gave every reactor (a long list can be cut short).
  const complete = slackMessages.filter((m) => (m.reactions ?? []).every((r: any) => (r.users?.length ?? 0) >= (r.count ?? 0)));
  const completeTs = new Set(complete.map((m) => m.ts as string));
  await markRemovedSlackReactions(
    service,
    uniqueMessages.filter((m) => completeTs.has(m.message_ts)),
    uniqueReactions,
    importedAt
  );

  for (let i = 0; i < timestamps.length; i += PROJECT_CONCURRENCY) {
    await Promise.all(timestamps.slice(i, i + PROJECT_CONCURRENCY).map((ts) => projectChatMessage(service, slackChannelId, ts)));
  }
  return { messages: newMessages, reactions: newReactions, seen: uniqueMessages.length };
}

/** Claim, run, record. Never throws: a failure is recorded and returned. */
async function run(
  service: SupabaseClient,
  claimed: Promise<string | null>,
  work: () => Promise<{ messages: number; reactions: number; seen: number }>
): Promise<GapFillResult> {
  const id = await claimed;
  if (!id) return NOT_DONE;
  try {
    const recovered = await work();
    await finish(service, id, recovered);
    return { claimed: true, ...recovered };
  } catch (error: any) {
    const message = String(error?.data?.error ?? error?.message ?? error).slice(0, 300);
    console.error("gap-fill failed:", message);
    await finish(service, id, { messages: 0, reactions: 0, seen: 0, error: message });
    return { claimed: true, messages: 0, reactions: 0, seen: 0, error: message };
  }
}

/** Every reply of one thread, root first (conversations.replies), up to a cap. */
async function fetchThread(slack: WebClient, slackChannelId: string, threadTs: string): Promise<SlackMsg[]> {
  const out: SlackMsg[] = [];
  let cursor: string | undefined;
  do {
    const result = await slack.conversations.replies({ channel: slackChannelId, ts: threadTs, cursor, limit: 200 });
    out.push(...((result.messages ?? []) as SlackMsg[]));
    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor && out.length < MAX_THREAD_REPLIES);
  return out;
}

/** Live replies already stored per thread root (by root ts), to tell which threads Slack is ahead on. */
async function storedReplyCounts(service: SupabaseClient, slackChannelId: string, rootTs: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (rootTs.length === 0) return counts;
  for (const row of await createRepos(service).slackMessages.threadMessages(slackChannelId, rootTs)) {
    if (row.message_ts === row.thread_ts) continue; // the root itself
    counts.set(row.thread_ts, (counts.get(row.thread_ts) ?? 0) + 1);
  }
  return counts;
}

/** Whether the chat has this message already. */
async function chatHasMessage(service: SupabaseClient, slackChannelId: string, ts: string): Promise<boolean> {
  const channelId = await createRepos(service).chat.idBySlackChannel(slackChannelId);
  if (!channelId) return false;
  return Boolean(await createRepos(service).chat.messageIdBySlackTs(channelId, ts).catch(() => null));
}

/**
 * One message we were told about but don't have (the webhook delivered a reaction or edit on it).
 * `reactions.get` returns any message by ts, a thread reply included, with its reactions; if it is a
 * reply whose root we also lack, the whole thread is fetched too.
 */
export async function fillMessageGap(
  service: SupabaseClient,
  opts: { channelId: string; ts: string; source: GapFillSource; slack?: WebClient }
): Promise<GapFillResult> {
  if (!chatSlackWritesEnabled()) return NOT_DONE;
  const channel = await mirroredChannel(service, opts.channelId);
  if (!channel) return NOT_DONE;
  return run(service, claim(service, opts.source, "message", opts.channelId, opts.ts), async () => {
    const slack = opts.slack ?? new WebClient(await getSlackBotToken());
    const result: any = await slack.reactions.get({ channel: opts.channelId, timestamp: opts.ts, full: true });
    const message = result.message as SlackMsg | undefined;
    if (!message) return { messages: 0, reactions: 0, seen: 0 };
    const fetched: SlackMsg[] = [message];
    const rootTs = message.thread_ts && message.thread_ts !== message.ts ? (message.thread_ts as string) : null;
    if (rootTs && !(await chatHasMessage(service, opts.channelId, rootTs))) fetched.push(...(await fetchThread(slack, opts.channelId, rootTs)));
    return storeAndProject(service, opts.channelId, channel, fetched);
  });
}

/** A thread whose root we don't have (a reply arrived): the whole thread. Nothing if the root is already here. */
export async function fillThreadIfRootMissing(
  service: SupabaseClient,
  opts: { channelId: string; threadTs: string; source: GapFillSource; slack?: WebClient }
): Promise<GapFillResult> {
  if (!chatSlackWritesEnabled()) return NOT_DONE;
  const channel = await mirroredChannel(service, opts.channelId);
  if (!channel || (await chatHasMessage(service, opts.channelId, opts.threadTs))) return NOT_DONE;
  return run(service, claim(service, opts.source, "thread", opts.channelId, opts.threadTs), async () => {
    const slack = opts.slack ?? new WebClient(await getSlackBotToken());
    return storeAndProject(service, opts.channelId, channel, await fetchThread(slack, opts.channelId, opts.threadTs));
  });
}

/**
 * Catches a conversation up with Slack when someone opens it: up to 100 top-level messages from the
 * last few hours (or newer than our newest, if that is further back), and the replies of up to 10 threads
 * Slack has more replies on than we do. The import covers the rest.
 */
export async function catchUpChannel(
  service: SupabaseClient,
  opts: { channelId: string; source: GapFillSource; slack?: WebClient }
): Promise<GapFillResult> {
  if (!chatSlackWritesEnabled()) return NOT_DONE;
  const channel = await mirroredChannel(service, opts.channelId);
  if (!channel) return NOT_DONE;
  return run(service, claim(service, opts.source, "channel", opts.channelId, null), async () => {
    const slack = opts.slack ?? new WebClient(await getSlackBotToken());
    const newestTs = await createRepos(service).slackMessages.newestTimestamp(opts.channelId);
    const nowSeconds = Math.floor(clock.now() / 1000);
    // From the newest message we have, or the lookback window if that is further back (see CATCH_UP_LOOKBACK_SECONDS).
    const oldest = String(
      newestTs ? Math.min(Number(newestTs), nowSeconds - CATCH_UP_LOOKBACK_SECONDS) : nowSeconds - FIRST_CATCH_UP_WINDOW_SECONDS
    );

    const result: any = await slack.conversations.history({ channel: opts.channelId, oldest, limit: MAX_CATCH_UP_MESSAGES });
    const fetched = ((result.messages ?? []) as SlackMsg[]).filter((m) => typeof m.ts === "string");

    // Replies only for threads where Slack has more than we do (the import's rule), so looking back over
    // a busy window isn't a conversations.replies call per thread.
    const roots = fetched.filter((m) => (m.reply_count ?? 0) > 0);
    const stored = await storedReplyCounts(service, opts.channelId, roots.map((m) => m.ts as string));
    const behind = roots.filter((m) => (stored.get(m.ts as string) ?? 0) < (m.reply_count ?? 0)).slice(0, MAX_CATCH_UP_THREADS);
    for (const root of behind) fetched.push(...(await fetchThread(slack, opts.channelId, root.ts)).filter((m) => m.ts !== root.ts));
    return storeAndProject(service, opts.channelId, channel, fetched);
  });
}
