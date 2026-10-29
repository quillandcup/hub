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
}
