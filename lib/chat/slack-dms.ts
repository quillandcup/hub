import { WebClient } from "@slack/web-api";
import { createSlackClient } from "@/lib/slack-client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import { chatSlackWritesEnabled } from "@/lib/chat/slack-post";
import { getSlackConnectionStatus, getSlackUserToken, isDeadTokenError, SLACK_DM_SCOPES } from "@/lib/slack-connect";
import { fetchThread, storedReplyCounts, storeAndProject } from "@/lib/chat/gap-fill";
import { isKeptSlackMessage } from "@/lib/slack-messages";
import { projectChatMessage } from "@/lib/chat-projection";
import { notifyPulledMessages } from "@/lib/chat/notifications";
import { deletionInferenceWindow, isSuspiciousDeletionCount, messagesMissingFromSlack, slackThreadKey } from "@/lib/slack-deletions";
import { clock } from "@/lib/clock";
import { ensureSlackFileCopied, slackFilesFromMessages } from "@/lib/slack-capture";
import { membersWithFeatureForOutreach } from "@/lib/features.server";

/**
 * Slack 1:1 DMs, read with the member's own token (docs/SLACK_BRIDGED_CHAT.md, "Slack 1:1 DMs through members'
 * own tokens"). The bot can't be in a DM, so this is the only way they reach the Hub: list the member's DMs,
 * store them in Bronze exactly like channel messages, and project them into chat as direct messages (kind
 * 'dm', private, restricted: staff only through break-glass access). Idempotent: Bronze is keyed on
 * (channel, ts), and both people in a DM see the same Slack channel id, so two connected members share one copy.
 * Service role. Behind the `slack_dm_bridge` feature (the caller checks it per member).
 */

/** At most one pull of a member's DMs per this many seconds, however often they open chat. */
export const SLACK_DM_PULL_INTERVAL_SECONDS = 300;
/** Slack's free plan serves about 90 days of history; the first pull of a DM goes back that far. */
const FIRST_PULL_DAYS = 90;
const PAGE_SIZE = 200;
/** Pages of history per DM per pull: 2,000 messages. A busier DM catches up over the next pulls (oldest first). */
const MAX_PAGES = 10;
/** Threads whose replies are fetched per DM per pull; the next pull continues. */
const MAX_THREADS = 30;
/** How far back a pull re-reads a DM besides what is new (reactions, edits, replies, deletions): when a member opens chat, and for the nightly run. */
const OPEN_LOOKBACK_DAYS = 1;
const NIGHTLY_LOOKBACK_DAYS = 7;
/** Files copied into our bucket by a pull when a member opens chat (it runs after the page, so a few); the nightly run copies every one that is pending, until its time is up. */
const OPEN_FILE_COPIES = 10;
const NIGHTLY_FILE_COPIES = Number.MAX_SAFE_INTEGER;
/** A conversation someone's token read this recently is not read again by another's: opening chat, and the nightly run (where two people's passes are minutes apart). */
const OPEN_FRESH_SECONDS = 10 * 60;
const NIGHTLY_FRESH_SECONDS = 6 * 60 * 60;
/** Opening chat reads conversations active this recently; older ones are left to live events and the nightly run. */
const RECENT_DAYS = 30;
/** Conversations never read before that one pull of a member opening chat takes on; a member with hundreds is caught up over several pulls. */
const OPEN_NEW_CONVERSATIONS = 20;

export interface DmPullResult {
  conversations: number;
  messages: number;
  /** The pull stopped before reaching every conversation because its time was up (the nightly run reports it). */
  incomplete: boolean;
  /** What went wrong for this member (a DM that failed, a pull cut short), for the nightly run to report. A connection Slack dropped isn't one: the member is asked to reconnect. */
  errors: string[];
}

const errorCode = (error: unknown): string | undefined => (error as { data?: { error?: string } } | null)?.data?.error;
const isRateLimited = (error: unknown): boolean => (error as { code?: string } | null)?.code === "slack_webapi_rate_limited_error";

type SlackMessage = Record<string, any>;

interface SlackIm {
  id: string;
  /** The other person's Slack user id. */
  user?: string;
  is_user_deleted?: boolean;
  created?: number;
}

/** A group DM as `conversations.list` (types mpim) reports it. */
interface SlackGroup {
  id: string;
  is_mpim?: boolean;
  is_archived?: boolean;
  num_members?: number;
  created?: number;
}

/**
 * Pulls one member's DMs from Slack into Bronze and the chat. Returns null when nothing was done: not
 * production (like every read or write of the real workspace), no connection with the DM scopes, or pulled
 * within the interval. A dead token revokes the connection; a rate limit or a missing scope stops the pull
 * (the next one retries); one DM failing is logged and the others go on. `force` skips the interval (a live event
 * named a DM the chat hasn't seen), and `only` then pulls just that conversation.
 *
 * A member can have hundreds of DMs, and Slack allows about a call a second for a method across the whole app, so a pull
 * reads only what it has to (`planPull`): a conversation someone read a moment ago is not read again (both people in a DM,
 * and everyone in a group, see the same conversation), one with no recent activity is left to live events and the nightly
 * run, one found empty is remembered instead of getting a chat conversation, and a first read of many is spread over several
 * pulls. The nightly run (`patient`) waits out Slack's rate limit within its `deadline` instead of stopping.
 */
export async function pullMemberDms(
  service: SupabaseClient,
  memberId: string,
  opts: { force?: boolean; lookbackDays?: number; fileCopies?: number; deadline?: number; patient?: boolean; only?: string } = {}
): Promise<DmPullResult | null> {
  if (!chatSlackWritesEnabled()) return null;
  const status = await getSlackConnectionStatus(service, memberId);
  if (!status.connected || !status.hasDmScopes || !status.slackUserId) return null;
  const { data: claimed } = await service.rpc("chat_claim_slack_dm_pull", { p_member: memberId, p_min_seconds: opts.force ? 0 : SLACK_DM_PULL_INTERVAL_SECONDS });
  if (!claimed) return null;
  const connection = await getSlackUserToken(service, memberId);
  if (!connection) return null;

  const repos = createRepos(service);
  // On opening chat: fail fast on a rate limit instead of sleeping inside a request. The nightly run waits (Slack's Retry-After).
  const slack = createSlackClient(connection.token, opts.patient ? {} : { rejectRateLimitedCalls: true, retryConfig: { retries: 0 } });
  const result: DmPullResult = { conversations: 0, messages: 0, errors: [], incomplete: false };
  const lookbackSeconds = (opts.lookbackDays ?? OPEN_LOOKBACK_DAYS) * 86400;
  try {
    const ims = await listConversations<SlackIm>(slack, "im");
    // Group DMs the bot is not in (the ones it is in are bridged by the bot).
    const groups = (await listConversations<SlackGroup>(slack, "mpim")).filter((c) => c.is_mpim === true);
    const candidates: Candidate[] = [
      // Slackbot's "DM" is Slack's own, and a deactivated person's can't change.
      ...ims.filter((im) => im.user && im.user !== "USLACKBOT" && !im.is_user_deleted).map((im): Candidate => ({ id: im.id, im })),
      ...groups.map((group): Candidate => ({ id: group.id, group })),
    ].filter((c) => opts.only === undefined || c.id === opts.only);
    const plan = await planPull(repos, memberId, candidates, { patient: opts.patient ?? false, everything: opts.only !== undefined });

    const dmIds = new Set<string>();
    for (const item of plan) {
      if (opts.deadline !== undefined && clock.now() >= opts.deadline) {
        result.incomplete = true;
        break;
      }
      try {
        const pulled = item.im
          ? await pullOneDm(service, repos, slack, { memberId, selfSlackId: connection.slackUserId, im: item.im, lookbackSeconds, readHistory: item.readHistory, inChat: item.inChat })
          : await pullOneGroupDm(service, repos, slack, { memberId, selfSlackId: connection.slackUserId, group: item.group as SlackGroup, lookbackSeconds, readHistory: item.readHistory, inChat: item.inChat });
        if (!pulled.chatChannelId) continue;
        result.messages += pulled.fetched;
        dmIds.add(item.id);
        result.conversations += 1;
      } catch (error) {
        if (isDeadTokenError(error) || isRateLimited(error) || errorCode(error) === "missing_scope") throw error;
        console.error("pullMemberDms failed for a conversation of member %s:", memberId, error);
        result.errors.push(`a conversation of member ${memberId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // Their files, with their own token (the bot can't read a DM's files), while Slack still serves them.
    await copyPendingDmFiles(service, repos, connection.token, dmIds, { max: opts.fileCopies ?? OPEN_FILE_COPIES, deadline: opts.deadline });
  } catch (error) {
    if (isDeadTokenError(error)) await service.rpc("slack_connection_revoke", { p_member: memberId });
    else if (isRateLimited(error) || errorCode(error) === "missing_scope") {
      console.warn("pullMemberDms stopped for member %s: %s", memberId, errorCode(error) ?? "rate limited");
      result.errors.push(`member ${memberId}: stopped on ${errorCode(error) ?? "a rate limit"}`);
    } else {
      console.error("pullMemberDms failed for member %s:", memberId, error);
      result.errors.push(`member ${memberId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

interface Candidate {
  id: string;
  im?: SlackIm;
  group?: SlackGroup;
}

interface PlannedConversation extends Candidate {
  /** Whether to read its history from Slack (false: someone read it a moment ago; only make sure this member is in it). */
  readHistory: boolean;
  /** Whether the chat already has a conversation for it. */
  inChat: boolean;
}

/** One list of the member's conversations of a type (paginated). */
async function listConversations<T extends { id: string }>(slack: WebClient, types: "im" | "mpim"): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await slack.conversations.list({ types, limit: PAGE_SIZE, cursor, exclude_archived: false });
    out.push(...((page.channels ?? []) as T[]).filter((c) => c.id));
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return out;
}

/**
 * Which of a member's conversations this pull reads, and in what order (most recently active first, then ones never read).
 * Skipped: one read within the freshness window by anyone and already in this member's chat; and, when opening chat only, one
 * with no activity for `RECENT_DAYS` (new messages arrive as live events, and the nightly run reads everything), one a pull found
 * empty before, and any first read of a conversation beyond `OPEN_NEW_CONVERSATIONS` (the next pulls continue). Asking for one
 * conversation (`everything`) skips none of this.
 */
async function planPull(
  repos: ReturnType<typeof createRepos>,
  memberId: string,
  candidates: Candidate[],
  opts: { patient: boolean; everything: boolean }
): Promise<PlannedConversation[]> {
  if (candidates.length === 0) return [];
  const ids = candidates.map((c) => c.id);
  const [pulledAt, channels, joined] = await Promise.all([
    repos.slackWorkspace.pulledAt(ids),
    repos.chat.listChannels(),
    repos.chat.joinedChannelIds(memberId),
  ]);
  const chatBySlack = new Map(channels.filter((c) => c.slack_channel_id).map((c) => [c.slack_channel_id as string, c]));
  const nowMs = clock.now();
  const freshMs = (opts.patient ? NIGHTLY_FRESH_SECONDS : OPEN_FRESH_SECONDS) * 1000;
  const recentMs = RECENT_DAYS * 86400 * 1000;

  const planned: (PlannedConversation & { activity: number })[] = [];
  for (const c of candidates) {
    const chat = chatBySlack.get(c.id);
    const last = pulledAt.get(c.id);
    const fresh = last !== undefined && nowMs - Date.parse(last) < freshMs;
    const entry = { ...c, readHistory: opts.everything || !fresh, inChat: Boolean(chat), activity: chat?.last_message_at ? Date.parse(chat.last_message_at) : -Infinity };
    if (!opts.everything) {
      if (fresh && chat && joined.has(chat.id)) continue;
      if (!opts.patient && last !== undefined) {
        if (!chat) continue;
        // A conversation this member isn't in yet is always worth joining them to, however quiet.
        if (joined.has(chat.id) && entry.activity < nowMs - recentMs) continue;
      }
    }
    planned.push(entry);
  }
  planned.sort((a, b) => b.activity - a.activity);
  if (opts.patient || opts.everything) return planned;
  // Opening chat reads only so many conversations it has never read; the rest come on the next pulls.
  let neverRead = 0;
  return planned.filter((c) => (pulledAt.has(c.id) ? true : ++neverRead <= OPEN_NEW_CONVERSATIONS));
}

async function pullOneDm(
  service: SupabaseClient,
  repos: ReturnType<typeof createRepos>,
  slack: WebClient,
  opts: { memberId: string; selfSlackId: string; im: SlackIm; lookbackSeconds: number; readHistory: boolean; inChat: boolean; allowEmpty?: boolean }
): Promise<{ chatChannelId: string | null; fetched: number }> {
  const { memberId, selfSlackId, im } = opts;
  const otherSlackId = im.user as string;
  // Slack also lists the member's self-DM: one participant, and one row per upsert key.
  const participantIds = [...new Set([selfSlackId, otherSlackId])];
  const now = new Date(clock.now()).toISOString();
  const row = {
    channel_id: im.id,
    name: "",
    is_private: true,
    is_mpim: false,
    is_im: true,
    im_user_id: otherSlackId,
    is_archived: false,
    member_count: participantIds.length,
    created: im.created ? new Date(im.created * 1000).toISOString() : null,
    raw_payload: im as never,
    imported_at: now,
  };

  // A conversation the chat has none for yet is read first: one with nothing in it is remembered (so it isn't read again
  // and gets no chat conversation), the rest are registered below and the messages already read are stored.
  let first: FirstRead | null = null;
  if (!opts.inChat && opts.readHistory) {
    first = await readFromTheStart(slack, im.id);
    if (first.topLevel.length === 0 && !opts.allowEmpty) {
      await repos.slackWorkspace.upsertChannels([{ ...row, last_pulled_at: now }]);
      return { chatChannelId: null, fetched: 0 };
    }
  }

  // The conversation and its participants in Bronze, then in the chat (the Hub members among them).
  await repos.slackWorkspace.upsertChannels([row]);
  await repos.slackWorkspace.upsertMemberships(
    participantIds.map((user_id) => ({ channel_id: im.id, user_id, left_at: null, imported_at: now }))
  );
  const others = await repos.chat.memberIdsBySlackUser([otherSlackId]);
  const people: Record<string, string> = { [selfSlackId]: memberId };
  const otherMember = others.get(otherSlackId);
  if (otherMember) people[otherSlackId] = otherMember;
  const { data: projected, error } = await service.rpc("project_slack_dm", { p_channel_id: im.id, p_members: people });
  if (error) throw new Error(error.message);
  const chatChannelId = (projected as { channel?: string | null } | null)?.channel;
  if (!chatChannelId) return { chatChannelId: null, fetched: 0 };
  if (!opts.readHistory) return { chatChannelId, fetched: 0 };

  const fetched = await pullConversationMessages(service, repos, slack, { conversationId: im.id, chatChannelId, type: "im", lookbackSeconds: opts.lookbackSeconds, first });
  await repos.slackWorkspace.markPulled([im.id], now);
  return { chatChannelId, fetched };
}

/**
 * One group DM the bot is not in, with the member's own token. A group the bot has recorded is left to the bot (its members
 * and messages come from the bot's import and events: nothing here touches that row); one it has not is recorded as
 * `token_only` and is in the chat of the Hub members among its Slack members who have pulled their own DMs
 * (project_slack_group_dm). Returns a null chat channel when the bot reads the group.
 */
async function pullOneGroupDm(
  service: SupabaseClient,
  repos: ReturnType<typeof createRepos>,
  slack: WebClient,
  opts: { memberId: string; selfSlackId: string; group: SlackGroup; lookbackSeconds: number; readHistory: boolean; inChat: boolean }
): Promise<{ chatChannelId: string | null; fetched: number }> {
  const { memberId, selfSlackId, group } = opts;
  const now = new Date(clock.now()).toISOString();

  // Recorded only if the bot has not: never overwrites its row, and the marker is never set on a group it knows.
  await repos.slackWorkspace.insertChannelIfAbsent({
    channel_id: group.id,
    // A group's Slack name lists its members: not stored (nor shown).
    name: "",
    is_private: true,
    is_mpim: true,
    is_im: false,
    token_only: true,
    is_archived: group.is_archived ?? false,
    member_count: group.num_members ?? null,
    created: group.created ? new Date(group.created * 1000).toISOString() : null,
    raw_payload: { id: group.id },
    imported_at: now,
  });
  if (!(await repos.slackWorkspace.isTokenOnlyGroupDm(group.id))) return { chatChannelId: null, fetched: 0 };

  // One the chat has none for yet and with nothing in it is remembered, not given a conversation (the Wheel of Wonder opens many rooms nobody writes in).
  let first: FirstRead | null = null;
  if (!opts.inChat && opts.readHistory) {
    first = await readFromTheStart(slack, group.id);
    if (first.topLevel.length === 0) {
      await repos.slackWorkspace.markPulled([group.id], now);
      return { chatChannelId: null, fetched: 0 };
    }
  }

  // Who is in it, with this token (paginated), kept as current in Bronze; someone who is no longer listed has left.
  const slackIds = new Set<string>([selfSlackId]);
  let cursor: string | undefined;
  do {
    const page = await slack.conversations.members({ channel: group.id, limit: PAGE_SIZE, cursor });
    for (const id of page.members ?? []) slackIds.add(id);
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);
  await repos.slackWorkspace.upsertMemberships([...slackIds].map((user_id) => ({ channel_id: group.id, user_id, left_at: null, imported_at: now })));
  const gone = (await repos.slackWorkspace.currentMemberUserIds(group.id)).filter((id) => !slackIds.has(id));
  if (gone.length > 0) await repos.slackWorkspace.markMembersLeft(group.id, gone, now);

  const matched = await repos.chat.memberIdsBySlackUser([...slackIds]);
  const people: Record<string, string> = { ...Object.fromEntries(matched), [selfSlackId]: memberId };
  const { data: projected, error } = await service.rpc("project_slack_group_dm", { p_channel_id: group.id, p_members: people });
  if (error) throw new Error(error.message);
  const chatChannelId = (projected as { channel?: string | null } | null)?.channel;
  if (!chatChannelId) return { chatChannelId: null, fetched: 0 };
  if (!opts.readHistory) return { chatChannelId, fetched: 0 };

  const fetched = await pullConversationMessages(service, repos, slack, { conversationId: group.id, chatChannelId, type: "mpim", lookbackSeconds: opts.lookbackSeconds, first });
  await repos.slackWorkspace.markPulled([group.id], now);
  return { chatChannelId, fetched };
}

/** What Slack returned for a conversation read from the beginning of what it serves, before the chat has a conversation for it. */
interface FirstRead {
  topLevel: SlackMessage[];
  complete: boolean;
  oldestSeconds: number;
}

/** The top-level messages of a conversation from `oldest` (paginated, up to `MAX_PAGES`), and whether that was all of them. */
async function readHistory(slack: WebClient, conversationId: string, oldest: string): Promise<{ topLevel: SlackMessage[]; complete: boolean }> {
  const topLevel: SlackMessage[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const history = await slack.conversations.history({ channel: conversationId, oldest, limit: PAGE_SIZE, cursor, inclusive: false });
    topLevel.push(...((history.messages ?? []) as SlackMessage[]).filter((m) => typeof m.ts === "string"));
    cursor = history.response_metadata?.next_cursor || undefined;
    if (!history.has_more || !cursor) return { topLevel, complete: true };
  }
  return { topLevel, complete: false };
}

/** A conversation the chat has nothing of yet, from as far back as Slack serves. */
async function readFromTheStart(slack: WebClient, conversationId: string): Promise<FirstRead> {
  const oldestSeconds = Math.floor(clock.now() / 1000) - FIRST_PULL_DAYS * 86400;
  return { ...(await readHistory(slack, conversationId, String(oldestSeconds))), oldestSeconds };
}

/**
 * The messages of one projected conversation (a 1:1 DM, or a group DM only the member's token reads) from Slack into Bronze
 * and the chat, with replies, reactions, edits, files and deletions: the same for both. `first` is what was already read
 * for a conversation the chat had none for. Returns how many messages were new.
 */
async function pullConversationMessages(
  service: SupabaseClient,
  repos: ReturnType<typeof createRepos>,
  slack: WebClient,
  opts: { conversationId: string; chatChannelId: string; type: "im" | "mpim"; lookbackSeconds: number; first?: FirstRead | null }
): Promise<number> {
  const { conversationId, chatChannelId, type } = opts;
  const now = new Date(clock.now()).toISOString();
  const nowSeconds = Math.floor(clock.now() / 1000);
  let topLevel: SlackMessage[];
  let complete: boolean;
  let oldestSeconds: number;
  if (opts.first) {
    ({ topLevel, complete, oldestSeconds } = opts.first);
  } else {
    // From the newest message the chat has, or `lookbackSeconds` back if that is further (an older message can gain
    // a reaction, an edit or a reply, or be deleted); the first pull goes back as far as Slack serves.
    const newest = await repos.chat.newestSlackTs(chatChannelId, now).catch(() => null);
    const lookbackFloor = nowSeconds - opts.lookbackSeconds;
    // The newest message's own ts when it is the older bound (kept as Slack wrote it: a float would round its microseconds).
    const oldest = newest ? (Number(newest) <= lookbackFloor ? newest : String(lookbackFloor)) : String(nowSeconds - FIRST_PULL_DAYS * 86400);
    oldestSeconds = Number(oldest);
    ({ topLevel, complete } = await readHistory(slack, conversationId, oldest));
  }

  // Replies of the threads Slack has more of than we do (history returns only each thread's first message).
  const roots = topLevel.filter((m) => (m.reply_count ?? 0) > 0);
  const storedReplies = await storedReplyCounts(service, conversationId, roots.map((m) => m.ts as string));
  const behind = roots.filter((m) => (storedReplies.get(m.ts as string) ?? 0) < (m.reply_count ?? 0)).slice(0, MAX_THREADS);
  const replies: SlackMessage[] = [];
  const repliesByThread = new Map<string, Set<string>>();
  for (const root of behind) {
    const thread = await fetchThread(slack, conversationId, root.ts as string);
    const others = thread.filter((m) => m.ts !== root.ts);
    replies.push(...others);
    repliesByThread.set(slackThreadKey(conversationId, root.ts as string), new Set(others.map((m) => m.ts as string)));
  }

  // Bronze (messages, reactions, taken-back reactions), then the chat, exactly as a channel's gap-fill does.
  const stored = await storeAndProject(service, conversationId, { name: "", type }, [...topLevel, ...replies]);
  await notifyPulledMessages(repos, conversationId, [...topLevel, ...replies].map((m) => m.ts as string));

  // The files on them are recorded now and copied by the sweep after the pull (the member's token; the bot can't read a DM's files).
  const withFiles = [...topLevel, ...replies].filter((m) => isKeptSlackMessage(m) && Array.isArray(m.files) && m.files.length > 0);
  if (withFiles.length > 0) {
    const refs = slackFilesFromMessages(withFiles.map((m) => ({ channel_id: conversationId, message_ts: m.ts as string, files: m.files })));
    await repos.slackMessages.recordFiles(refs.map((f) => ({ ...f, imported_at: now })));
  }

  // A message in the window that Slack no longer returns was deleted there: only where the whole window was
  // fetched, and by the import's rules (never because it aged out of Slack's history; not a sudden mass disappearance).
  const window = complete ? deletionInferenceWindow(oldestSeconds, nowSeconds, clock.now()) : null;
  if (window) {
    const inWindow = await repos.slackMessages.storedMessagesBetween(window.from, window.to, conversationId);
    const seen = { topLevelByChannel: new Map([[conversationId, new Set(topLevel.map((m) => m.ts as string))]]), repliesByThread };
    const nothingSeen = {
      topLevelByChannel: new Map([[conversationId, new Set<string>()]]),
      repliesByThread: new Map([...repliesByThread.keys()].map((key) => [key, new Set<string>()])),
    };
    const judged = messagesMissingFromSlack(inWindow, nothingSeen, window).length;
    const missing = messagesMissingFromSlack(inWindow, seen, window);
    if (missing.length > 0 && !isSuspiciousDeletionCount(missing.length, judged)) {
      await repos.slackMessages.markMessagesDeleted(conversationId, missing.map((m) => m.message_ts), now);
      await Promise.all(missing.map((m) => projectChatMessage(service, conversationId, m.message_ts)));
    }
  }
  return stored.messages;
}

/**
 * Copies the DM files still without a copy, oldest message first (those are the next to fall out of Slack's
 * history), into the private bucket with the member's own token. Only files of these conversations: the bot's
 * import copies the rest. At most `max`, none started after `deadline`; a file that fails is tried again by the
 * next pull (and when someone opens it), and one the import has skipped for good (too large) is left alone.
 */
async function copyPendingDmFiles(
  service: SupabaseClient,
  repos: ReturnType<typeof createRepos>,
  token: string,
  dmIds: Set<string>,
  opts: { max: number; deadline?: number }
): Promise<void> {
  if (dmIds.size === 0) return;
  let left = opts.max;
  for (const file of await repos.slackMessages.filesWithoutCopy()) {
    if (left <= 0 || (opts.deadline !== undefined && clock.now() >= opts.deadline)) break;
    if (!dmIds.has(file.channel_id) || file.deleted_at || file.copy_error?.startsWith("skipped:")) continue;
    left--;
    const copied = await ensureSlackFileCopied(service, token, { fileId: file.file_id, channelId: file.channel_id, messageTs: file.message_ts });
    if (!copied.ok) console.warn("a DM file wasn't copied (%s): %s", file.file_id, copied.reason);
  }
}

export type OpenDmResult =
  | { ok: true; channelId: string }
  | { ok: false; reason: "not_production" | "not_connected" | "unknown_person" | "slack_refused" };

/**
 * The member's Slack DM with another member, opened with the member's own token (`conversations.open` is
 * find-or-create: an existing DM comes back as it is) and brought into the chat with what Slack has of it,
 * so the conversation can be opened and written in at once. The other person must be known by their Slack
 * id (a member who connected Slack, or one the matching has linked). Nothing is sent to anyone. Does
 * nothing off production, like every Slack call of the real workspace.
 */
export async function openSlackDm(service: SupabaseClient, memberId: string, otherMemberId: string): Promise<OpenDmResult> {
  if (!chatSlackWritesEnabled()) return { ok: false, reason: "not_production" };
  const status = await getSlackConnectionStatus(service, memberId);
  if (!status.connected || !status.hasDmScopes || !status.slackUserId) return { ok: false, reason: "not_connected" };
  const connection = await getSlackUserToken(service, memberId);
  if (!connection) return { ok: false, reason: "not_connected" };

  const repos = createRepos(service);
  const otherSlackId = (await repos.chat.slackUserIdsByMember([otherMemberId])).get(otherMemberId);
  if (!otherSlackId) return { ok: false, reason: "unknown_person" };

  const slack = createSlackClient(connection.token, { rejectRateLimitedCalls: true, retryConfig: { retries: 0 } });
  // Opening a DM counts as pulling the member's DMs: a Slack DM is in the chat of the members who have pulled (project_slack_dm).
  await service.rpc("chat_claim_slack_dm_pull", { p_member: memberId, p_min_seconds: 0 });
  try {
    const opened = await slack.conversations.open({ users: otherSlackId, return_im: true });
    const im = opened.channel as SlackIm | undefined;
    if (!im?.id) return { ok: false, reason: "slack_refused" };
    // A DM just opened is wanted in the chat even with nothing in it yet.
    const inChat = (await repos.chat.idBySlackChannel(im.id).catch(() => null)) !== null;
    const { chatChannelId } = await pullOneDm(service, repos, slack, { memberId, selfSlackId: connection.slackUserId, im: { ...im, user: otherSlackId }, lookbackSeconds: OPEN_LOOKBACK_DAYS * 86400, readHistory: true, inChat, allowEmpty: true });
    return chatChannelId ? { ok: true, channelId: chatChannelId } : { ok: false, reason: "slack_refused" };
  } catch (error) {
    if (isDeadTokenError(error)) {
      await service.rpc("slack_connection_revoke", { p_member: memberId });
      return { ok: false, reason: "not_connected" };
    }
    console.error("openSlackDm failed for member %s:", memberId, error);
    return { ok: false, reason: "slack_refused" };
  }
}

export interface NightlyDmPullResult {
  /** Members the bridge covers who have the DM scopes. */
  members: number;
  conversations: number;
  messages: number;
  /** Members left for the next run because the time ran out. */
  deferred: number;
  /** Members whose pull ran out of time part way (their later conversations wait for the next run). */
  incomplete: number;
  errors: string[];
}

/**
 * The nightly backstop for live delivery (Slack's events can be missed, and a member who never opens chat is
 * never pulled): pull the DMs of every member the `slack_dm_bridge` feature covers who has a working
 * connection with the DM scopes, ignoring the interval. One member at a time, oldest pull first, and no new
 * member after `deadline` (a clock time, ms) so the run ends inside its function time; the rest are next run's.
 */
export async function pullDmsForCoveredMembers(service: SupabaseClient, opts: { deadline: number }): Promise<NightlyDmPullResult> {
  const repos = createRepos(service);
  const connected = await repos.memberProfile.memberIdsWithSlackScopes(SLACK_DM_SCOPES);
  const covered = [...(await membersWithFeatureForOutreach(repos, "slack_dm_bridge", connected))];
  const result: NightlyDmPullResult = { members: covered.length, conversations: 0, messages: 0, deferred: 0, incomplete: 0, errors: [] };
  for (const [index, memberId] of covered.entries()) {
    if (clock.now() >= opts.deadline) {
      result.deferred = covered.length - index;
      break;
    }
    try {
      const pulled = await pullMemberDms(service, memberId, { force: true, patient: true, lookbackDays: NIGHTLY_LOOKBACK_DAYS, fileCopies: NIGHTLY_FILE_COPIES, deadline: opts.deadline });
      if (!pulled) continue;
      if (pulled.incomplete) result.incomplete += 1;
      result.conversations += pulled.conversations;
      result.messages += pulled.messages;
      result.errors.push(...pulled.errors);
    } catch (error) {
      result.errors.push(`member ${memberId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}
