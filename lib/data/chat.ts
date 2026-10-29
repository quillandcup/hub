import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** A stored row, as the database has it, with only the named columns required: a test or seed names just what it cares about. */
type Seed<T, K extends keyof T> = Pick<T, K> & Partial<Omit<T, K>>;

/** The chat rows as the in-memory dataset keeps them. */
export type ChatChannelSeed = Seed<Row<"chat_channels">, "id">;
export type ChatChannelMemberSeed = Seed<Row<"chat_channel_members">, "channel_id" | "member_id">;
export type ChatMessageSeed = Seed<Row<"chat_messages">, "id" | "channel_id">;
export type ChatMessageContentSeed = Seed<Row<"chat_message_contents">, "message_id">;
export type ChatReactionSeed = Seed<Row<"chat_reactions">, "message_id">;
export type ChatSlackAuthorSeed = Seed<Row<"chat_slack_authors">, "slack_user_id" | "member_id">;
export type ChatGapFillSeed = Seed<Row<"chat_gap_fills">, "id">;

/** How a channel is wired to Slack: whether the Hub mirrors it, whether that is switched off, and its health. */
export interface BridgeState {
  bridge_mode: string;
  bridge_disabled: boolean;
  bridge_status: string;
}

/** A message as the chat page lists it, with its text and files joined in (null when the caller can't read the content). */
export interface ChatMessageRow {
  id: string;
  author_member_id: string | null;
  slack_ts: string | null;
  /** 'app' for a message written in the Hub, 'slack' for one projected from Slack. */
  origin: "app" | "slack";
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  reply_count: number;
  last_reply_at: string | null;
  has_files: boolean;
  system_subtype: string | null;
  slack_sync_status: "pending" | "sent" | "failed" | null;
  chat_message_contents: { body: string; files: unknown } | null;
}

/** A search hit's message: the columns the search results show, plus where it sits in its conversation. */
export interface ChatSearchMessageRow {
  id: string;
  channel_id: string;
  thread_root_id: string | null;
  author_member_id: string | null;
  slack_ts: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  reply_count: number;
  last_reply_at: string | null;
  has_files: boolean;
  chat_message_contents: { body: string; files: unknown } | null;
}

/** What a chat search asks for: the filters of the `search_chat_messages` function. */
export interface ChatSearchQuery {
  /** to_tsquery expression; empty for a filters-only search. */
  tsquery: string;
  channelIds: string[];
  authorMemberIds: string[] | null;
  from: string | null;
  /** Exclusive upper bound. */
  to: string | null;
  hasFiles: boolean;
  inThread: boolean;
  hasLink: boolean;
  hasReaction: boolean;
  limit: number;
  offset: number;
}

/** Who wrote a live reply, for the avatar stack of its thread. */
export interface ChatReplyAuthorRow {
  thread_root_id: string;
  author_member_id: string | null;
  slack_ts: string | null;
}

/** A live reaction, by a Hub member or by someone only Slack knows. */
export interface ChatReactionRow {
  message_id: string;
  emoji: string;
  member_id: string | null;
  slack_user_id: string | null;
}

const MESSAGE_COLUMNS =
  "id, author_member_id, slack_ts, origin, created_at, edited_at, deleted_at, reply_count, last_reply_at, has_files, system_subtype, slack_sync_status, chat_message_contents(body, files)";
const SEARCH_MESSAGE_COLUMNS =
  "id, channel_id, thread_root_id, author_member_id, slack_ts, created_at, edited_at, deleted_at, reply_count, last_reply_at, has_files, chat_message_contents(body, files)";
/** The API returns at most this many rows per request (1000 in production), however many match. */
const REACTION_PAGE = 1000;
const ID_CHUNK = 200;

type PagedResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** A conversation as the chat pages list it. */
export interface ChannelRecord {
  id: string;
  kind: "channel" | "dm" | "group_dm";
  visibility: "public" | "private";
  restricted: boolean;
  name: string | null;
  archived_at: string | null;
  slack_channel_id: string | null;
}

/** What decides whether a conversation's members can be changed from the Hub. */
export interface ChannelManageSettings {
  kind: string;
  visibility: string;
  slack_channel_id: string | null;
  bridge_mode: string;
  bridge_disabled: boolean;
  bridge_status: string;
  archived_at: string | null;
}

/** One conversation a member is in, with what is needed to ask Slack about their read marker. */
export interface SlackReadTarget {
  channelId: string;
  slackChannelId: string | null;
  archivedAt: string | null;
  bridgeDisabled: boolean;
}

/** A line the Hub writes itself into a conversation when someone is added or removed. */
export interface MembershipNoticeInput {
  channelId: string;
  /** The person it is about: it is their line. */
  authorMemberId: string;
  subtype: "channel_join" | "channel_leave";
  /** Already escaped for Slack-style text. */
  body: string;
  createdAt: string;
}

const CHANNEL_COLUMNS = "id, kind, visibility, restricted, name, archived_at, slack_channel_id";
/** Ids per `.in(...)` request. */
const IN_CHUNK = 100;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * Chat: the Hub's mirror of bridged Slack conversations and what members do in it. The repository
 * takes whichever client the caller has, so the privilege is the client's: message text sits in its own
 * table (`chat_message_contents`) that RLS hides per channel, and reads of it stay on the client they
 * use today. This is the skeleton; the channel, membership, message, content, author and gap-fill
 * methods are added by slice, each in its own labelled section. Every method throws on a database error.
 */
export interface ChatRepository {
  /** A channel's Slack bridge settings, or null when there is no such channel (or it isn't visible to the caller). */
  bridgeState(channelId: string): Promise<BridgeState | null>;
  /** The Hub id of the channel that mirrors this Slack channel, or null when none does. */
  idBySlackChannel(slackChannelId: string): Promise<string | null>;

  // --- message reads ---
  /** Top-level messages of a conversation, newest first, at most `limit`; with `before`, only those created earlier. */
  channelMessages(channelId: string, opts: { before?: string | null; limit: number }): Promise<ChatMessageRow[]>;
  /** One thread's replies, oldest first, at most `limit`. */
  threadMessages(channelId: string, threadRootId: string, limit: number): Promise<ChatMessageRow[]>;
  /** Specific top-level messages of a conversation (replies are left out), in no particular order. */
  topLevelMessagesByIds(channelId: string, ids: string[]): Promise<ChatMessageRow[]>;
  /** One message of a conversation by id, or null. */
  messageById(channelId: string, messageId: string): Promise<ChatMessageRow | null>;
  /** The id of the newest message of a conversation (top-level, or of one thread), or null when there is none. */
  newestMessageId(channelId: string, threadRootId: string | null): Promise<string | null>;
  /** Messages by id for a search page, with their place in the conversation; ones the caller can't read are absent. */
  searchMessagesByIds(ids: string[]): Promise<ChatSearchMessageRow[]>;
  /** Ids of the messages matching a search, best first, as the caller can read them (RLS applies). */
  searchMessageIds(query: ChatSearchQuery): Promise<string[]>;
  /** The author of every live reply to these thread roots, oldest first; all pages. */
  replyAuthorRows(rootIds: string[]): Promise<ChatReplyAuthorRow[]>;
  /** Every live reaction on these messages, in a stable order; all pages. */
  reactionRows(messageIds: string[]): Promise<ChatReactionRow[]>;

  // --- channels and membership ---

  /** Every conversation the client can see, by name then id (RLS decides which). */
  listChannels(): Promise<ChannelRecord[]>;
  /** One conversation, or null when there is none (or it isn't visible to the caller). */
  channelRecord(channelId: string): Promise<ChannelRecord | null>;
  /** The settings that decide whether membership can change, or null for a missing conversation. */
  manageSettings(channelId: string): Promise<ChannelManageSettings | null>;
  /** The Slack id of a conversation, or null when it has none (or there is no such conversation). */
  slackChannelOf(channelId: string): Promise<string | null>;
  /** Ids of the conversations the member is in now. */
  joinedChannelIds(memberId: string): Promise<Set<string>>;
  /** Whether the member is in the conversation now. */
  isInChannel(channelId: string, memberId: string): Promise<boolean>;
  /** The member's current place in a conversation (its source), or null when they are not in it. */
  activeMembership(channelId: string, memberId: string): Promise<{ source: string } | null>;
  /** Who is in a conversation now, by member id. */
  activeMemberIds(channelId: string): Promise<string[]>;
  /** Who is in each of these conversations now. */
  activeMembersOf(channelIds: string[]): Promise<{ channel_id: string; member_id: string }[]>;
  /** Which of these members are in the conversation now. */
  presentMembers(channelId: string, memberIds: string[]): Promise<Set<string>>;
  /** Where the member has read up to (their marker, else when they joined), or null when they are not in the conversation. */
  readMarker(channelId: string, memberId: string): Promise<string | null>;
  /** Put people in a conversation; one who left and returns is back, not added twice. */
  addMembers(channelId: string, people: { memberId: string; source: "slack" | "app" }[], joinedAt: string): Promise<void>;
  /** Mark the member as having left the conversation (a no-op when they are not in it). */
  markLeft(channelId: string, memberId: string, leftAt: string): Promise<void>;
  /** The conversations the member is in now with their Slack settings, by conversation id. */
  slackReadTargets(memberId: string): Promise<SlackReadTarget[]>;
  /** Write the notice line for a membership change (the message and its text). */
  recordMembershipNotice(notice: MembershipNoticeInput): Promise<void>;
  /** What deciding whether a member may retry a message needs (null when there is no such message, or it isn't visible to the caller). */
  retryState(messageId: string): Promise<{ author_member_id: string | null; origin: string; slack_sync_status: string | null } | null>;
  /** The Slack timestamp of the newest top-level, undeleted message that came from Slack, created at or before `through`. */
  newestSlackTs(channelId: string, through: string): Promise<string | null>;

  // --- message writes ---
  // The Hub -> Slack outbox, edits and deletes, reactions and the webhook's lookups. The Slack API itself stays with
  // the callers; these are the reads and writes around it.

  /** What a Slack write needs to know about one message, with its channel's Slack id; null when there is no such message. */
  slackTarget(messageId: string): Promise<SlackMessageTarget | null>;
  /** A message as the outbox posts it: the target plus its text and (staged) files; null when there is no such message. */
  outboxMessage(messageId: string): Promise<OutboxMessage | null>;
  /** Records that Slack took an app message at this ts. A message already sent, or not ours, is left alone; a copy the Slack echo already made is folded in. */
  markSent(messageId: string, slackTs: string): Promise<void>;
  /** Marks a still-pending app message failed. A message in any other state is left alone. */
  markFailed(messageId: string): Promise<void>;
  /** Records which identity posted an app message. */
  setPostedVia(messageId: string, via: "user_token" | "bot"): Promise<void>;
  /** Marks every app message still pending and created at or before this instant failed; returns how many. */
  expireStalePending(createdAtOrBefore: string): Promise<number>;
  /** Ids of live app messages still pending or failed, created strictly between the two instants, oldest first. */
  unsentMessageIds(opts: { createdBefore: string; createdAfter: string; limit: number }): Promise<string[]>;
  /** Marks a member's own Hub reaction as agreed with Slack. */
  markReactionSynced(opts: { messageId: string; emoji: string; memberId: string }): Promise<void>;
  /** The member who wrote an app (Hub) message, or null when it isn't one or has no author. */
  appMessageAuthor(messageId: string): Promise<string | null>;
}

/** One message as a Slack write sees it. */
export interface SlackMessageTarget {
  id: string;
  origin: string;
  systemSubtype: string | null;
  authorMemberId: string | null;
  postedVia: string | null;
  slackTs: string | null;
  slackSyncStatus: string | null;
  deletedAt: string | null;
  threadRootId: string | null;
  /** The Slack id of the message's channel, or null when the channel isn't bridged. */
  slackChannelId: string | null;
}

export interface OutboxMessage extends SlackMessageTarget {
  /** Empty when the message has no text. */
  body: string;
  /** The files column as stored (parse it with `parseChatFiles`), or null. */
  files: unknown;
}

type Embedded<T> = T | T[] | null;
const one = <T>(v: Embedded<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

const TARGET_COLUMNS = "id, origin, system_subtype, author_member_id, posted_via, slack_ts, slack_sync_status, deleted_at, thread_root_id";

type TargetRow = {
  id: string;
  origin: string;
  system_subtype: string | null;
  author_member_id: string | null;
  posted_via: string | null;
  slack_ts: string | null;
  slack_sync_status: string | null;
  deleted_at: string | null;
  thread_root_id: string | null;
  chat_channels: Embedded<{ slack_channel_id: string | null }>;
  chat_message_contents?: Embedded<{ body: string; files: unknown }>;
};

function toTarget(row: TargetRow): SlackMessageTarget {
  return {
    id: row.id,
    origin: row.origin,
    systemSubtype: row.system_subtype,
    authorMemberId: row.author_member_id,
    postedVia: row.posted_via,
    slackTs: row.slack_ts,
    slackSyncStatus: row.slack_sync_status,
    deletedAt: row.deleted_at,
    threadRootId: row.thread_root_id,
    slackChannelId: one(row.chat_channels)?.slack_channel_id ?? null,
  };
}

export class SupabaseChatRepository implements ChatRepository {
  constructor(private readonly db: Db) {}

  async bridgeState(channelId: string) {
    const { data, error } = await this.db.from("chat_channels").select("bridge_mode, bridge_disabled, bridge_status").eq("id", channelId).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async idBySlackChannel(slackChannelId: string) {
    const { data, error } = await this.db.from("chat_channels").select("id").eq("slack_channel_id", slackChannelId).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.id ?? null;
  }

  // --- message reads ---
  async channelMessages(channelId: string, opts: { before?: string | null; limit: number }) {
    let query = this.db.from("chat_messages").select(MESSAGE_COLUMNS).eq("channel_id", channelId).is("thread_root_id", null);
    if (opts.before) query = query.lt("created_at", opts.before);
    const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(opts.limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ChatMessageRow[];
  }

  async threadMessages(channelId: string, threadRootId: string, limit: number) {
    const { data, error } = await this.db
      .from("chat_messages")
      .select(MESSAGE_COLUMNS)
      .eq("channel_id", channelId)
      .eq("thread_root_id", threadRootId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ChatMessageRow[];
  }

  async topLevelMessagesByIds(channelId: string, ids: string[]) {
    const out: ChatMessageRow[] = [];
    for (const part of chunk(ids, ID_CHUNK)) {
      const { data, error } = await this.db.from("chat_messages").select(MESSAGE_COLUMNS).eq("channel_id", channelId).is("thread_root_id", null).in("id", part);
      if (error) throw new Error(error.message);
      out.push(...((data ?? []) as unknown as ChatMessageRow[]));
    }
    return out;
  }

  async messageById(channelId: string, messageId: string) {
    const { data, error } = await this.db.from("chat_messages").select(MESSAGE_COLUMNS).eq("channel_id", channelId).eq("id", messageId).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as ChatMessageRow | null) ?? null;
  }

  async newestMessageId(channelId: string, threadRootId: string | null) {
    let query = this.db.from("chat_messages").select("id").eq("channel_id", channelId);
    query = threadRootId === null ? query.is("thread_root_id", null) : query.eq("thread_root_id", threadRootId);
    const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    return data?.[0]?.id ?? null;
  }

  async searchMessagesByIds(ids: string[]) {
    const out: ChatSearchMessageRow[] = [];
    for (const part of chunk(ids, ID_CHUNK)) {
      const { data, error } = await this.db.from("chat_messages").select(SEARCH_MESSAGE_COLUMNS).in("id", part);
      if (error) throw new Error(error.message);
      out.push(...((data ?? []) as unknown as ChatSearchMessageRow[]));
    }
    return out;
  }

  async searchMessageIds(q: ChatSearchQuery) {
    // The function's arguments default to null, which its generated argument types don't allow.
    const args = {
      p_query: q.tsquery,
      p_channel_ids: q.channelIds,
      p_author_member_ids: q.authorMemberIds,
      p_from: q.from,
      p_to: q.to,
      p_has_files: q.hasFiles ? true : null,
      p_in_thread: q.inThread ? true : null,
      p_has_link: q.hasLink ? true : null,
      p_has_reaction: q.hasReaction ? true : null,
      p_limit: q.limit,
      p_offset: q.offset,
    };
    const { data, error } = await this.db.rpc("search_chat_messages", args as never);
    if (error) throw new Error(error.message);
    return (data ?? []).map((h) => h.message_id);
  }

  async replyAuthorRows(rootIds: string[]) {
    const out: ChatReplyAuthorRow[] = [];
    for (const part of chunk(rootIds, ID_CHUNK)) {
      const rows = await fetchAllRows<ChatReplyAuthorRow>(
        (from, to) =>
          this.db
            .from("chat_messages")
            .select("thread_root_id, author_member_id, slack_ts")
            .in("thread_root_id", part)
            .is("deleted_at", null)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to) as unknown as PagedResult<ChatReplyAuthorRow>
      );
      out.push(...rows);
    }
    return out;
  }

  /**
   * A busy conversation can carry more than one page of reactions (production has pages with over
   * 2,500), and a single unordered request returns an arbitrary first thousand: whole messages then
   * lose their reactions. So: a stable order, the rest fetched in parallel once the first page says
   * how many there are, and a database error is an error, not an empty list (which would read as
   * "everyone took theirs back").
   */
  async reactionRows(messageIds: string[]) {
    const out: ChatReactionRow[] = [];
    for (const part of chunk(messageIds, ID_CHUNK)) out.push(...(await this.reactionPages(part)));
    return out;
  }

  private async reactionPages(messageIds: string[]): Promise<ChatReactionRow[]> {
    const page = (from: number) =>
      this.db
        .from("chat_reactions")
        .select("message_id, emoji, member_id, slack_user_id", from === 0 ? { count: "exact" } : undefined)
        .in("message_id", messageIds)
        .is("deleted_at", null)
        .order("id")
        .range(from, from + REACTION_PAGE - 1);
    const first = await page(0);
    if (first.error) throw new Error(`chat_reactions read failed: ${first.error.message}`);
    const rows = (first.data ?? []) as ChatReactionRow[];
    if (rows.length < REACTION_PAGE) return rows;
    const fetchPage = async (from: number) => {
      const next = await page(from);
      if (next.error) throw new Error(`chat_reactions read failed: ${next.error.message}`);
      return (next.data ?? []) as ChatReactionRow[];
    };
    if (typeof first.count === "number") {
      const starts: number[] = [];
      for (let from = REACTION_PAGE; from < first.count; from += REACTION_PAGE) starts.push(from);
      return rows.concat(...(await Promise.all(starts.map(fetchPage))));
    }
    let all = rows;
    for (let from = REACTION_PAGE; ; from += REACTION_PAGE) {
      const next = await fetchPage(from);
      all = all.concat(next);
      if (next.length < REACTION_PAGE) return all;
    }
  }

  // --- channels and membership ---

  async listChannels() {
    return fetchAllRows<ChannelRecord>(
      (from, to) => this.db.from("chat_channels").select(CHANNEL_COLUMNS).order("name").order("id").range(from, to) as unknown as Page<ChannelRecord>
    );
  }

  async channelRecord(channelId: string) {
    const { data, error } = await this.db.from("chat_channels").select(CHANNEL_COLUMNS).eq("id", channelId).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as ChannelRecord | null) ?? null;
  }

  async manageSettings(channelId: string) {
    const { data, error } = await this.db
      .from("chat_channels")
      .select("kind, visibility, slack_channel_id, bridge_mode, bridge_disabled, bridge_status, archived_at")
      .eq("id", channelId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async slackChannelOf(channelId: string) {
    const { data, error } = await this.db.from("chat_channels").select("slack_channel_id").eq("id", channelId).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.slack_channel_id ?? null;
  }

  async joinedChannelIds(memberId: string) {
    const rows = await fetchAllRows<{ channel_id: string }>((from, to) =>
      this.db.from("chat_channel_members").select("channel_id").eq("member_id", memberId).is("left_at", null).order("channel_id").range(from, to)
    );
    return new Set(rows.map((r) => r.channel_id));
  }

  async isInChannel(channelId: string, memberId: string) {
    return (await this.activeMembership(channelId, memberId)) !== null;
  }

  async activeMembership(channelId: string, memberId: string) {
    const { data, error } = await this.db
      .from("chat_channel_members")
      .select("source")
      .eq("channel_id", channelId)
      .eq("member_id", memberId)
      .is("left_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async activeMemberIds(channelId: string) {
    const rows = await fetchAllRows<{ member_id: string }>((from, to) =>
      this.db.from("chat_channel_members").select("member_id").eq("channel_id", channelId).is("left_at", null).order("member_id").range(from, to)
    );
    return rows.map((r) => r.member_id);
  }

  async activeMembersOf(channelIds: string[]) {
    const out: { channel_id: string; member_id: string }[] = [];
    for (const ids of chunk(channelIds, IN_CHUNK)) {
      out.push(
        ...(await fetchAllRows<{ channel_id: string; member_id: string }>((from, to) =>
          this.db
            .from("chat_channel_members")
            .select("channel_id, member_id")
            .in("channel_id", ids)
            .is("left_at", null)
            .order("channel_id")
            .order("member_id")
            .range(from, to)
        ))
      );
    }
    return out;
  }

  async presentMembers(channelId: string, memberIds: string[]) {
    const present = new Set<string>();
    for (const ids of chunk(memberIds, IN_CHUNK)) {
      const { data, error } = await this.db.from("chat_channel_members").select("member_id").eq("channel_id", channelId).in("member_id", ids).is("left_at", null);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) present.add(r.member_id);
    }
    return present;
  }

  async readMarker(channelId: string, memberId: string) {
    const { data, error } = await this.db
      .from("chat_channel_members")
      .select("last_read_at, joined_at")
      .eq("channel_id", channelId)
      .eq("member_id", memberId)
      .is("left_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? (data.last_read_at ?? data.joined_at) : null;
  }

  async addMembers(channelId: string, people: { memberId: string; source: "slack" | "app" }[], joinedAt: string) {
    if (people.length === 0) return;
    const { error } = await this.db
      .from("chat_channel_members")
      .upsert(
        people.map((p) => ({ channel_id: channelId, member_id: p.memberId, joined_at: joinedAt, left_at: null, source: p.source })),
        { onConflict: "channel_id,member_id" }
      );
    if (error) throw new Error(error.message);
  }

  async markLeft(channelId: string, memberId: string, leftAt: string) {
    const { error } = await this.db.from("chat_channel_members").update({ left_at: leftAt }).eq("channel_id", channelId).eq("member_id", memberId).is("left_at", null);
    if (error) throw new Error(error.message);
  }

  async slackReadTargets(memberId: string) {
    type Joined = { slack_channel_id: string | null; archived_at: string | null; bridge_disabled: boolean };
    type Row = { channel_id: string; chat_channels: Joined | Joined[] | null };
    const rows = await fetchAllRows<Row>(
      (from, to) =>
        this.db
          .from("chat_channel_members")
          .select("channel_id, chat_channels!inner(slack_channel_id, archived_at, bridge_disabled)")
          .eq("member_id", memberId)
          .is("left_at", null)
          .order("channel_id")
          .range(from, to) as unknown as Page<Row>
    );
    return rows.flatMap((r) => {
      const c = Array.isArray(r.chat_channels) ? r.chat_channels[0] : r.chat_channels;
      return c ? [{ channelId: r.channel_id, slackChannelId: c.slack_channel_id, archivedAt: c.archived_at, bridgeDisabled: c.bridge_disabled }] : [];
    });
  }

  async recordMembershipNotice(n: MembershipNoticeInput) {
    const { data, error } = await this.db
      .from("chat_messages")
      .insert({ channel_id: n.channelId, author_member_id: n.authorMemberId, origin: "app", system_subtype: n.subtype, created_at: n.createdAt })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const { error: contentError } = await this.db.from("chat_message_contents").insert({ message_id: data.id, body: n.body });
    if (contentError) throw new Error(contentError.message);
  }

  async retryState(messageId: string) {
    const { data, error } = await this.db.from("chat_messages").select("author_member_id, origin, slack_sync_status").eq("id", messageId).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async newestSlackTs(channelId: string, through: string) {
    const { data, error } = await this.db
      .from("chat_messages")
      .select("slack_ts")
      .eq("channel_id", channelId)
      .is("thread_root_id", null)
      .is("deleted_at", null)
      .not("slack_ts", "is", null)
      .lte("created_at", through)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.slack_ts ?? null;
  }

  // --- message writes ---

  async slackTarget(messageId: string) {
    const { data, error } = await this.db.from("chat_messages").select(`${TARGET_COLUMNS}, chat_channels(slack_channel_id)`).eq("id", messageId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toTarget(data as unknown as TargetRow) : null;
  }

  async outboxMessage(messageId: string) {
    const { data, error } = await this.db
      .from("chat_messages")
      .select(`${TARGET_COLUMNS}, chat_message_contents(body, files), chat_channels(slack_channel_id)`)
      .eq("id", messageId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const row = data as unknown as TargetRow;
    const content = one(row.chat_message_contents ?? null);
    return { ...toTarget(row), body: content?.body ?? "", files: content?.files ?? null };
  }

  async markSent(messageId: string, slackTs: string) {
    const { error } = await this.db.rpc("chat_mark_message_sent", { p_message_id: messageId, p_slack_ts: slackTs });
    if (error) throw new Error(error.message);
  }

  async markFailed(messageId: string) {
    const { error } = await this.db.rpc("chat_mark_message_failed", { p_message_id: messageId });
    if (error) throw new Error(error.message);
  }

  async setPostedVia(messageId: string, via: "user_token" | "bot") {
    const { error } = await this.db.from("chat_messages").update({ posted_via: via }).eq("id", messageId);
    if (error) throw new Error(error.message);
  }

  async expireStalePending(createdAtOrBefore: string) {
    const { data, error } = await this.db
      .from("chat_messages")
      .update({ slack_sync_status: "failed" })
      .eq("origin", "app")
      .eq("slack_sync_status", "pending")
      .lte("created_at", createdAtOrBefore)
      .select("id");
    if (error) throw new Error(error.message);
    return data.length;
  }

  async unsentMessageIds(opts: { createdBefore: string; createdAfter: string; limit: number }) {
    const { data, error } = await this.db
      .from("chat_messages")
      .select("id")
      .eq("origin", "app")
      .in("slack_sync_status", ["pending", "failed"])
      .is("deleted_at", null)
      .lt("created_at", opts.createdBefore)
      .gt("created_at", opts.createdAfter)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(opts.limit);
    if (error) throw new Error(error.message);
    return data.map((r) => r.id);
  }

  async markReactionSynced(opts: { messageId: string; emoji: string; memberId: string }) {
    const { error } = await this.db
      .from("chat_reactions")
      .update({ synced_to_slack: true })
      .eq("message_id", opts.messageId)
      .eq("emoji", opts.emoji)
      .eq("member_id", opts.memberId)
      .is("slack_user_id", null);
    if (error) throw new Error(error.message);
  }

  async appMessageAuthor(messageId: string) {
    const { data, error } = await this.db.from("chat_messages").select("author_member_id").eq("id", messageId).eq("origin", "app").maybeSingle();
    if (error) throw new Error(error.message);
    return data?.author_member_id ?? null;
  }
}

const time = (m: { created_at?: string }) => Date.parse(m.created_at ?? new Date(0).toISOString());
const newestFirst = (a: ChatMessageSeed, b: ChatMessageSeed) => time(b) - time(a) || b.id.localeCompare(a.id);
const oldestFirst = (a: ChatMessageSeed, b: ChatMessageSeed) => time(a) - time(b) || a.id.localeCompare(b.id);

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryChatRepository implements ChatRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async bridgeState(channelId: string) {
    const c = this.data.chatChannels.find((x) => x.id === channelId);
    // The column defaults, as the database fills them in.
    return c ? { bridge_mode: c.bridge_mode ?? "bridged", bridge_disabled: c.bridge_disabled ?? false, bridge_status: c.bridge_status ?? "ok" } : null;
  }

  async idBySlackChannel(slackChannelId: string) {
    return this.data.chatChannels.find((c) => c.slack_channel_id === slackChannelId)?.id ?? null;
  }

  // --- message reads ---
  private messageRow(m: ChatMessageSeed): ChatMessageRow {
    const c = this.data.chatMessageContents.find((x) => x.message_id === m.id);
    return {
      id: m.id,
      author_member_id: m.author_member_id ?? null,
      slack_ts: m.slack_ts ?? null,
      // The column defaults, as the database fills them in.
      origin: (m.origin ?? "slack") as ChatMessageRow["origin"],
      created_at: m.created_at ?? new Date(0).toISOString(),
      edited_at: m.edited_at ?? null,
      deleted_at: m.deleted_at ?? null,
      reply_count: m.reply_count ?? 0,
      last_reply_at: m.last_reply_at ?? null,
      has_files: m.has_files ?? false,
      system_subtype: m.system_subtype ?? null,
      slack_sync_status: (m.slack_sync_status ?? null) as ChatMessageRow["slack_sync_status"],
      chat_message_contents: c ? { body: c.body ?? "", files: c.files ?? null } : null,
    };
  }

  async channelMessages(channelId: string, opts: { before?: string | null; limit: number }) {
    const before = opts.before ? Date.parse(opts.before) : null;
    return this.data.chatMessages
      .filter((m) => m.channel_id === channelId && !m.thread_root_id && (before === null || time(m) < before))
      .sort(newestFirst)
      .slice(0, opts.limit)
      .map((m) => this.messageRow(m));
  }

  async threadMessages(channelId: string, threadRootId: string, limit: number) {
    return this.data.chatMessages
      .filter((m) => m.channel_id === channelId && m.thread_root_id === threadRootId)
      .sort(oldestFirst)
      .slice(0, limit)
      .map((m) => this.messageRow(m));
  }

  async topLevelMessagesByIds(channelId: string, ids: string[]) {
    return this.data.chatMessages.filter((m) => m.channel_id === channelId && !m.thread_root_id && ids.includes(m.id)).map((m) => this.messageRow(m));
  }

  async messageById(channelId: string, messageId: string) {
    const m = this.data.chatMessages.find((x) => x.channel_id === channelId && x.id === messageId);
    return m ? this.messageRow(m) : null;
  }

  async newestMessageId(channelId: string, threadRootId: string | null) {
    const rows = this.data.chatMessages
      .filter((m) => m.channel_id === channelId && (threadRootId === null ? !m.thread_root_id : m.thread_root_id === threadRootId))
      .sort(newestFirst);
    return rows[0]?.id ?? null;
  }

  async searchMessagesByIds(ids: string[]) {
    return this.data.chatMessages
      .filter((m) => ids.includes(m.id))
      .map((m): ChatSearchMessageRow => {
        const r = this.messageRow(m);
        return {
          id: r.id,
          channel_id: m.channel_id,
          thread_root_id: m.thread_root_id ?? null,
          author_member_id: r.author_member_id,
          slack_ts: r.slack_ts,
          created_at: r.created_at,
          edited_at: r.edited_at,
          deleted_at: r.deleted_at,
          reply_count: r.reply_count,
          last_reply_at: r.last_reply_at,
          has_files: r.has_files,
          chat_message_contents: r.chat_message_contents,
        };
      });
  }

  /** A stand-in for Postgres full text: every word of the query must appear in the body; best first is newest first. */
  async searchMessageIds(q: ChatSearchQuery) {
    const words = q.tsquery
      .split(/[&|!()\s]+/)
      .map((w) => w.replace(/['":*]/g, "").toLowerCase())
      .filter(Boolean);
    const from = q.from ? Date.parse(q.from) : null;
    const to = q.to ? Date.parse(q.to) : null;
    return this.data.chatMessages
      .filter((m) => {
        const body = this.data.chatMessageContents.find((c) => c.message_id === m.id)?.body;
        if (body === undefined) return false;
        return (
          !m.deleted_at &&
          q.channelIds.includes(m.channel_id) &&
          words.every((w) => body.toLowerCase().includes(w)) &&
          (q.authorMemberIds === null || (m.author_member_id != null && q.authorMemberIds.includes(m.author_member_id))) &&
          (from === null || time(m) >= from) &&
          (to === null || time(m) < to) &&
          (!q.hasFiles || Boolean(m.has_files)) &&
          (!q.inThread || Boolean(m.thread_root_id)) &&
          (!q.hasLink || /<https?:\/\//.test(body)) &&
          (!q.hasReaction || this.data.chatReactions.some((r) => r.message_id === m.id && !r.deleted_at))
        );
      })
      .sort(newestFirst)
      .slice(q.offset, q.offset + q.limit)
      .map((m) => m.id);
  }

  async replyAuthorRows(rootIds: string[]) {
    return this.data.chatMessages
      .filter((m) => m.thread_root_id && rootIds.includes(m.thread_root_id) && !m.deleted_at)
      .sort(oldestFirst)
      .map((m) => ({ thread_root_id: m.thread_root_id as string, author_member_id: m.author_member_id ?? null, slack_ts: m.slack_ts ?? null }));
  }

  async reactionRows(messageIds: string[]) {
    return this.data.chatReactions
      .filter((r) => messageIds.includes(r.message_id) && !r.deleted_at)
      .sort((a, b) => (a.id ?? "").localeCompare(b.id ?? ""))
      .map((r) => ({ message_id: r.message_id, emoji: r.emoji ?? "", member_id: r.member_id ?? null, slack_user_id: r.slack_user_id ?? null }));
  }

  // --- channels and membership ---

  private record(c: ChatChannelSeed): ChannelRecord {
    // The column defaults, as the database fills them in.
    return {
      id: c.id,
      kind: (c.kind ?? "channel") as ChannelRecord["kind"],
      visibility: (c.visibility ?? "public") as ChannelRecord["visibility"],
      restricted: c.restricted ?? false,
      name: c.name ?? null,
      archived_at: c.archived_at ?? null,
      slack_channel_id: c.slack_channel_id ?? null,
    };
  }

  private active(channelId?: string) {
    return this.data.chatChannelMembers.filter((m) => !m.left_at && (channelId === undefined || m.channel_id === channelId));
  }

  async listChannels() {
    // Postgres sorts nulls last.
    const byName = (a: ChannelRecord, b: ChannelRecord) => (a.name === b.name ? 0 : a.name === null ? 1 : b.name === null ? -1 : a.name < b.name ? -1 : 1);
    return this.data.chatChannels.map((c) => this.record(c)).sort((a, b) => byName(a, b) || (a.id < b.id ? -1 : 1));
  }

  async channelRecord(channelId: string) {
    const c = this.data.chatChannels.find((x) => x.id === channelId);
    return c ? this.record(c) : null;
  }

  async manageSettings(channelId: string) {
    const c = this.data.chatChannels.find((x) => x.id === channelId);
    if (!c) return null;
    return {
      kind: c.kind ?? "channel",
      visibility: c.visibility ?? "public",
      slack_channel_id: c.slack_channel_id ?? null,
      bridge_mode: c.bridge_mode ?? "bridged",
      bridge_disabled: c.bridge_disabled ?? false,
      bridge_status: c.bridge_status ?? "ok",
      archived_at: c.archived_at ?? null,
    };
  }

  async slackChannelOf(channelId: string) {
    return this.data.chatChannels.find((c) => c.id === channelId)?.slack_channel_id ?? null;
  }

  async joinedChannelIds(memberId: string) {
    return new Set(this.active().filter((m) => m.member_id === memberId).map((m) => m.channel_id));
  }

  async isInChannel(channelId: string, memberId: string) {
    return this.active(channelId).some((m) => m.member_id === memberId);
  }

  async activeMembership(channelId: string, memberId: string) {
    const m = this.active(channelId).find((x) => x.member_id === memberId);
    return m ? { source: m.source ?? "slack" } : null;
  }

  async activeMemberIds(channelId: string) {
    return this.active(channelId).map((m) => m.member_id).sort();
  }

  async activeMembersOf(channelIds: string[]) {
    const wanted = new Set(channelIds);
    return this.active()
      .filter((m) => wanted.has(m.channel_id))
      .map((m) => ({ channel_id: m.channel_id, member_id: m.member_id }))
      .sort((a, b) => (a.channel_id === b.channel_id ? (a.member_id < b.member_id ? -1 : 1) : a.channel_id < b.channel_id ? -1 : 1));
  }

  async presentMembers(channelId: string, memberIds: string[]) {
    const wanted = new Set(memberIds);
    return new Set(this.active(channelId).filter((m) => wanted.has(m.member_id)).map((m) => m.member_id));
  }

  async readMarker(channelId: string, memberId: string) {
    const m = this.active(channelId).find((x) => x.member_id === memberId);
    return m ? (m.last_read_at ?? m.joined_at ?? null) : null;
  }

  async addMembers(channelId: string, people: { memberId: string; source: "slack" | "app" }[], joinedAt: string) {
    for (const p of people) {
      const row = this.data.chatChannelMembers.find((m) => m.channel_id === channelId && m.member_id === p.memberId);
      if (row) Object.assign(row, { joined_at: joinedAt, left_at: null, source: p.source });
      else this.data.chatChannelMembers.push({ channel_id: channelId, member_id: p.memberId, joined_at: joinedAt, left_at: null, source: p.source });
    }
  }

  async markLeft(channelId: string, memberId: string, leftAt: string) {
    const row = this.active(channelId).find((m) => m.member_id === memberId);
    if (row) row.left_at = leftAt;
  }

  async slackReadTargets(memberId: string) {
    return this.active()
      .filter((m) => m.member_id === memberId)
      .sort((a, b) => (a.channel_id < b.channel_id ? -1 : 1))
      .flatMap((m) => {
        const c = this.data.chatChannels.find((x) => x.id === m.channel_id);
        return c ? [{ channelId: c.id, slackChannelId: c.slack_channel_id ?? null, archivedAt: c.archived_at ?? null, bridgeDisabled: c.bridge_disabled ?? false }] : [];
      });
  }

  async recordMembershipNotice(n: MembershipNoticeInput) {
    const id = `msg_${String(this.data.chatMessages.length + 1).padStart(12, "A")}`;
    this.data.chatMessages.push({ id, channel_id: n.channelId, author_member_id: n.authorMemberId, origin: "app", system_subtype: n.subtype, created_at: n.createdAt });
    this.data.chatMessageContents.push({ message_id: id, body: n.body });
  }

  async retryState(messageId: string) {
    const m = this.data.chatMessages.find((x) => x.id === messageId);
    return m ? { author_member_id: m.author_member_id ?? null, origin: m.origin ?? "slack", slack_sync_status: m.slack_sync_status ?? null } : null;
  }

  async newestSlackTs(channelId: string, through: string) {
    const limit = Date.parse(through);
    const newest = this.data.chatMessages
      .filter((m) => m.channel_id === channelId && !m.thread_root_id && !m.deleted_at && m.slack_ts && m.created_at !== undefined && Date.parse(m.created_at) <= limit)
      .sort((a, b) => Date.parse(b.created_at as string) - Date.parse(a.created_at as string) || (a.id < b.id ? 1 : -1))[0];
    return newest?.slack_ts ?? null;
  }

  // --- message writes ---

  private target(m: ChatMessageSeed): SlackMessageTarget {
    return {
      id: m.id,
      origin: m.origin ?? "slack",
      systemSubtype: m.system_subtype ?? null,
      authorMemberId: m.author_member_id ?? null,
      postedVia: m.posted_via ?? null,
      slackTs: m.slack_ts ?? null,
      slackSyncStatus: m.slack_sync_status ?? null,
      deletedAt: m.deleted_at ?? null,
      threadRootId: m.thread_root_id ?? null,
      slackChannelId: this.data.chatChannels.find((c) => c.id === m.channel_id)?.slack_channel_id ?? null,
    };
  }

  async slackTarget(messageId: string) {
    const m = this.data.chatMessages.find((x) => x.id === messageId);
    return m ? this.target(m) : null;
  }

  async outboxMessage(messageId: string) {
    const m = this.data.chatMessages.find((x) => x.id === messageId);
    if (!m) return null;
    const content = this.data.chatMessageContents.find((c) => c.message_id === messageId);
    return { ...this.target(m), body: content?.body ?? "", files: content?.files ?? null };
  }

  async markSent(messageId: string, slackTs: string) {
    const msgs = this.data.chatMessages;
    const msg = msgs.find((x) => x.id === messageId && (x.origin ?? "slack") === "app");
    if (!msg || msg.slack_sync_status === "sent") return;

    // Slack's own echo of the post may already have made a copy: fold it into this row.
    const copy = msgs.find((x) => x.channel_id === msg.channel_id && x.slack_ts === slackTs && x.id !== messageId);
    if (copy) {
      for (const x of msgs) if (x.thread_root_id === copy.id) x.thread_root_id = messageId;
      if (!msg.thread_root_id) msg.reply_count = copy.reply_count ?? 0;
      this.data.chatMessages = msgs.filter((x) => x.id !== copy.id);
    }
    msg.slack_ts = slackTs;
    msg.slack_sync_status = "sent";

    const rootId = msg.thread_root_id;
    if (rootId && copy) {
      const root = this.data.chatMessages.find((x) => x.id === rootId);
      if (root) {
        const live = this.data.chatMessages.filter((x) => x.thread_root_id === rootId && !x.deleted_at);
        root.reply_count = live.length;
        root.last_reply_at = live.reduce<string | null>((max, x) => (x.created_at && (!max || x.created_at > max) ? x.created_at : max), null);
      }
    }
  }

  async markFailed(messageId: string) {
    const m = this.data.chatMessages.find((x) => x.id === messageId && (x.origin ?? "slack") === "app" && x.slack_sync_status === "pending");
    if (m) m.slack_sync_status = "failed";
  }

  async setPostedVia(messageId: string, via: "user_token" | "bot") {
    const m = this.data.chatMessages.find((x) => x.id === messageId);
    if (m) m.posted_via = via;
  }

  async expireStalePending(createdAtOrBefore: string) {
    const stale = this.data.chatMessages.filter((m) => (m.origin ?? "slack") === "app" && m.slack_sync_status === "pending" && (m.created_at ?? "") <= createdAtOrBefore);
    for (const m of stale) m.slack_sync_status = "failed";
    return stale.length;
  }

  async unsentMessageIds(opts: { createdBefore: string; createdAfter: string; limit: number }) {
    return this.data.chatMessages
      .filter(
        (m) =>
          (m.origin ?? "slack") === "app" &&
          (m.slack_sync_status === "pending" || m.slack_sync_status === "failed") &&
          !m.deleted_at &&
          (m.created_at ?? "") < opts.createdBefore &&
          (m.created_at ?? "") > opts.createdAfter
      )
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id))
      .slice(0, opts.limit)
      .map((m) => m.id);
  }

  async markReactionSynced(opts: { messageId: string; emoji: string; memberId: string }) {
    for (const r of this.data.chatReactions) {
      if (r.message_id === opts.messageId && r.emoji === opts.emoji && r.member_id === opts.memberId && !r.slack_user_id) r.synced_to_slack = true;
    }
  }

  async appMessageAuthor(messageId: string) {
    const m = this.data.chatMessages.find((x) => x.id === messageId && (x.origin ?? "slack") === "app");
    return m?.author_member_id ?? null;
  }
}
