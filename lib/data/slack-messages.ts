import { SLACK_SYSTEM_SUBTYPES } from "@/lib/slack-messages";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { chunk } from "@/lib/supabase/paginate";
import { asPage, byKeyThenId, compareText, inChunks, must, upsertInChunks } from "./query";
import { asJson } from "./json";
import type { Database } from "./database.types";
import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";

type MessageTable = Database["bronze"]["Tables"]["slack_messages"];
type ReactionTable = Database["bronze"]["Tables"]["slack_reactions"];

/**
 * A stored Slack message. The text, files and raw payload are service role only, so this is the
 * shape the in-memory dataset keeps (the whole row); admins read the metadata through
 * `slack_messages_meta`, which has no content columns (`SlackMessageMeta`).
 */
export type SlackMessageSeed = Pick<MessageTable["Row"], "channel_id" | "message_ts" | "user_id" | "occurred_at"> &
  Partial<Omit<MessageTable["Row"], "channel_id" | "message_ts" | "user_id" | "occurred_at">>;

/** A stored reaction as the in-memory dataset keeps it. */
export type SlackReactionSeed = Pick<ReactionTable["Row"], "channel_id" | "message_ts" | "reaction" | "user_id" | "occurred_at"> &
  Partial<Omit<ReactionTable["Row"], "channel_id" | "message_ts" | "reaction" | "user_id" | "occurred_at">>;

/** What the import and the webhook write for a message: `bronze.slack_messages`'s columns. */
export type NewSlackMessage = MessageTable["Insert"];

/** What the import and the webhook write for a reaction: `bronze.slack_reactions`'s columns. */
export type NewSlackReaction = ReactionTable["Insert"];

/** The natural key of a reaction: one row per user, emoji and message. */
export type ReactionKey = { channel_id: string; message_ts: string; reaction: string; user_id: string };

/** A message edit: the columns `message_changed` rewrites. */
export type SlackMessageEdit = {
  text: string;
  edited_at: string | null;
  reply_count: number;
  reply_users_count: number;
  files: unknown;
  raw_payload: unknown;
};

/** A stored message's place in its thread and in time (no content), for judging what went missing from Slack. */
export type StoredSlackMessageRef = { channel_id: string; message_ts: string; thread_ts: string | null; occurred_at: string };

type FileTable = Database["bronze"]["Tables"]["slack_files"];

/** What the capture records for a file attached to a message: `bronze.slack_files`'s columns. */
export type NewSlackFile = FileTable["Insert"];

/** A stored file: where it hangs, its metadata, and where our copy is. Service role only. */
export type SlackFile = Pick<
  FileTable["Row"],
  "file_id" | "channel_id" | "message_ts" | "name" | "mimetype" | "size_bytes" | "storage_path" | "copy_error" | "deleted_at"
> & {
  /** What Slack sent for the file (a vendor payload: the download URLs are in it). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw_payload: any;
};

/** A file as the in-memory dataset keeps it. */
export type SlackFileSeed = Pick<SlackFile, "file_id" | "channel_id" | "message_ts"> & Partial<Omit<SlackFile, "file_id" | "channel_id" | "message_ts">> & { copied_at?: string | null };

/** The columns of a file the copy and cleanup steps change. */
export type SlackFileChange = Partial<Pick<FileTable["Row"], "copy_error" | "storage_path" | "copied_at" | "deleted_at">>;

/** What the engagement stats read of a message (no content). */
export type SlackMessageEngagementRow = {
  channel_id: string;
  channel_name: string | null;
  occurred_at: string;
  deleted_at: string | null;
  user_id: string;
  thread_ts: string | null;
};

/** What the engagement stats read of a reaction. */
export type SlackReactionEngagementRow = {
  channel_id: string;
  channel_name: string | null;
  occurred_at: string;
  deleted_at: string | null;
  user_id: string;
  reaction: string;
};

/** When a message happened, in which channel (what the archival candidates are judged by). */
export type SlackMessageTime = { channel_id: string; occurred_at: string };

const SYSTEM_SUBTYPES: readonly string[] = SLACK_SYSTEM_SUBTYPES;

/**
 * Notices Slack posts itself (a channel rename) are not engagement. message_type is nullable, and a plain NOT IN
 * would drop those rows too.
 */
const NOT_SYSTEM = `message_type.is.null,message_type.not.in.(${SLACK_SYSTEM_SUBTYPES.join(",")})`;

/**
 * The Bronze copy of Slack's messages and reactions. Message text, files and the raw payload are service role
 * only ("Slack content is service role only", CLAUDE.md): methods that name content say so, and everything
 * an admin page needs goes through the content-free `slack_messages_meta` view. Reads throw on a database
 * error and page past 1000 rows (with a stable order).
 */
export interface SlackMessageRepository {
  /** How many messages (deleted ones included) each Slack user wrote, from the metadata view. */
  messageCountsByUser(): Promise<Map<string, number>>;
  /** When messages or reactions were last imported (webhook or bulk import), or null when there are none. */
  lastImportedAt(): Promise<string | null>;
  /** Live (not deleted), member-written messages from `from` to `to` inclusive, by time. Metadata only. */
  liveMessagesBetween(from: string, to: string): Promise<SlackMessageEngagementRow[]>;
  /** Live reactions from `from` to `to` inclusive, by time. */
  liveReactionsBetween(from: string, to: string): Promise<SlackReactionEngagementRow[]>;
  /** The channel and time of every live, member-written message, by time. Metadata only. */
  liveMessageTimes(): Promise<SlackMessageTime[]>;

  /**
   * Adds messages, or replaces the ones with the same channel and timestamp (an import is idempotent). Chunked.
   * Writes content, so it needs a service-role client.
   */
  upsertMessages(messages: NewSlackMessage[]): Promise<void>;
  /** Adds reactions, or replaces the ones with the same key (and brings back one taken back: write `deleted_at: null`). Chunked. */
  upsertReactions(reactions: NewSlackReaction[]): Promise<void>;
  /** Rewrites a stored message after an edit. A message we don't have is left alone. */
  editMessage(channelId: string, messageTs: string, edit: SlackMessageEdit): Promise<void>;
  /** Soft-deletes these messages of one channel (those not already deleted). Chunked. */
  markMessagesDeleted(channelId: string, messageTs: string[], at: string): Promise<void>;
  /** Soft-deletes one reaction (if it is live). */
  markReactionRemoved(key: ReactionKey, at: string): Promise<void>;
  /** Live messages that happened from `from` to `to` inclusive: where they are in their thread, no content. By channel then timestamp. */
  storedMessagesBetween(from: string, to: string): Promise<StoredSlackMessageRef[]>;
  /** The live reactions on these messages of one channel. Chunked. */
  liveReactionsOn(channelId: string, messageTs: string[]): Promise<ReactionKey[]>;
  /** Of these message timestamps in one channel, the ones we have stored (deleted or not). Chunked. */
  storedTimestamps(channelId: string, messageTs: string[]): Promise<Set<string>>;
  /** The newest stored message timestamp of a channel (deleted or not), or null. Service role. */
  newestTimestamp(channelId: string): Promise<string | null>;
  /** message ts -> the Slack user who wrote it, for these messages of one channel (those we have). Chunked. Service role. */
  authorsByTs(channelId: string, messageTs: string[]): Promise<Map<string, string>>;

  /** Records files seen on messages. A file we already have is left as it is (never overwrites its copy). Chunked. */
  recordFiles(files: NewSlackFile[]): Promise<void>;
  /** Saves a file's row, replacing the one with the same Slack file id. */
  replaceFile(file: NewSlackFile): Promise<void>;
  /** One file, or null. */
  fileById(fileId: string): Promise<SlackFile | null>;
  /** Changes some columns of one file. */
  updateFile(fileId: string, change: SlackFileChange): Promise<void>;
  /** The files we have no copy of yet (deleted ones included), oldest message first. */
  filesWithoutCopy(): Promise<SlackFile[]>;
  /** The live files on messages from `oldestMessageTs` on: where each hangs. By file id. */
  liveFilesSince(oldestMessageTs: string): Promise<{ file_id: string; channel_id: string; message_ts: string }[]>;
  /** Deleted files whose bytes are still stored, longest deleted first, at most `limit`. */
  deletedFilesWithBytes(limit: number): Promise<{ file_id: string; storage_path: string }[]>;

  /**
   * The live messages of these threads of one channel, the thread's own first message included, as
   * `{ thread_ts, message_ts }`. Chunked, and paged past 1000 rows.
   */
  threadMessages(channelId: string, threadTs: string[]): Promise<{ thread_ts: string; message_ts: string }[]>;
  /** Whether Bronze has any live message or reaction from `from` to `to` inclusive. */
  hasLiveActivityBetween(from: string, to: string): Promise<boolean>;
}

const TS_CHUNK = 100;
const AUTHOR_CHUNK = 200;
const FILE_COLUMNS = "file_id, channel_id, message_ts, name, mimetype, size_bytes, storage_path, copy_error, deleted_at, raw_payload";

const messageOrder = <Q extends { order(column: string): Q }>(q: Q) => q.order("occurred_at").order("channel_id").order("message_ts");

const reactionKeyOf = (r: ReactionKey) => `${r.channel_id}|${r.message_ts}|${r.reaction}|${r.user_id}`;
const sameReaction = (a: ReactionKey, b: ReactionKey) => reactionKeyOf(a) === reactionKeyOf(b);

export class SupabaseSlackMessageRepository implements SlackMessageRepository {
  constructor(private readonly db: Db) {}

  private get bronze() {
    return this.db.schema("bronze");
  }

  async messageCountsByUser() {
    const rows = await fetchAllRows<{ user_id: string | null }>((from, to) =>
      asPage<{ user_id: string | null }>(this.bronze.from("slack_messages_meta").select("user_id").order("channel_id").order("message_ts").range(from, to))
    );
    const counts = new Map<string, number>();
    for (const row of rows) if (row.user_id) counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
    return counts;
  }

  async lastImportedAt() {
    const [message, reaction] = await Promise.all([
      this.bronze.from("slack_messages_meta").select("imported_at").order("imported_at", { ascending: false }).limit(1).maybeSingle(),
      this.bronze.from("slack_reactions").select("imported_at").order("imported_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const times = [must(message)?.imported_at, must(reaction)?.imported_at].filter((t): t is string => !!t);
    return times.sort().pop() ?? null;
  }

  async liveMessagesBetween(from: string, to: string) {
    return fetchAllRows<SlackMessageEngagementRow>((first, last) =>
      asPage<SlackMessageEngagementRow>(
        messageOrder(
          this.bronze
            .from("slack_messages_meta")
            .select("channel_id, channel_name, occurred_at, deleted_at, user_id, thread_ts")
            .gte("occurred_at", from)
            .lte("occurred_at", to)
            .is("deleted_at", null)
            .or(NOT_SYSTEM)
        ).range(first, last)
      )
    );
  }

  async liveReactionsBetween(from: string, to: string) {
    return fetchAllRows<SlackReactionEngagementRow>((first, last) =>
      asPage<SlackReactionEngagementRow>(
        this.bronze
          .from("slack_reactions")
          .select("channel_id, channel_name, occurred_at, deleted_at, user_id, reaction")
          .gte("occurred_at", from)
          .lte("occurred_at", to)
          .is("deleted_at", null)
          .order("occurred_at")
          .order("channel_id")
          .order("message_ts")
          .order("reaction")
          .order("user_id")
          .range(first, last)
      )
    );
  }

  async liveMessageTimes() {
    return fetchAllRows<SlackMessageTime>((first, last) =>
      asPage<SlackMessageTime>(
        messageOrder(this.bronze.from("slack_messages_meta").select("channel_id, occurred_at").is("deleted_at", null).or(NOT_SYSTEM)).range(first, last)
      )
    );
  }

  async upsertMessages(messages: NewSlackMessage[]) {
    // Small chunks, two at a time: each upsert is one statement under the API role's 8s statement timeout.
    await upsertInChunks(this.bronze.from("slack_messages"), messages, "channel_id,message_ts", 100, 2);
  }

  async upsertReactions(reactions: NewSlackReaction[]) {
    await upsertInChunks(this.bronze.from("slack_reactions"), reactions, "channel_id,message_ts,reaction,user_id", 100, 2);
  }

  async editMessage(channelId: string, messageTs: string, edit: SlackMessageEdit) {
    must(
      await this.bronze
        .from("slack_messages")
        .update({ ...edit, files: asJson(edit.files), raw_payload: asJson(edit.raw_payload) })
        .eq("channel_id", channelId)
        .eq("message_ts", messageTs)
    );
  }

  async markMessagesDeleted(channelId: string, messageTs: string[], at: string) {
    for (const part of chunk(messageTs, TS_CHUNK)) {
      must(await this.bronze.from("slack_messages").update({ deleted_at: at }).eq("channel_id", channelId).in("message_ts", part).is("deleted_at", null));
    }
  }

  async markReactionRemoved(key: ReactionKey, at: string) {
    must(
      await this.bronze
        .from("slack_reactions")
        .update({ deleted_at: at })
        .eq("channel_id", key.channel_id)
        .eq("message_ts", key.message_ts)
        .eq("reaction", key.reaction)
        .eq("user_id", key.user_id)
        .is("deleted_at", null)
    );
  }

  async storedMessagesBetween(from: string, to: string) {
    return fetchAllRows<StoredSlackMessageRef>((first, last) =>
      asPage<StoredSlackMessageRef>(
        this.bronze
          .from("slack_messages")
          .select("channel_id, message_ts, thread_ts, occurred_at")
          .gte("occurred_at", from)
          .lte("occurred_at", to)
          .is("deleted_at", null)
          .order("channel_id")
          .order("message_ts")
          .range(first, last)
      )
    );
  }

  async liveReactionsOn(channelId: string, messageTs: string[]) {
    const keys: ReactionKey[] = [];
    for (const part of chunk(messageTs, TS_CHUNK)) {
      keys.push(
        ...(await fetchAllRows<ReactionKey>((first, last) =>
          asPage<ReactionKey>(
            this.bronze
              .from("slack_reactions")
              .select("channel_id, message_ts, reaction, user_id")
              .eq("channel_id", channelId)
              .in("message_ts", part)
              .is("deleted_at", null)
              .order("message_ts")
              .order("reaction")
              .order("user_id")
              .range(first, last)
          )
        ))
      );
    }
    return keys;
  }

  async storedTimestamps(channelId: string, messageTs: string[]) {
    const rows = await inChunks(messageTs, TS_CHUNK, async (part) =>
      must(await this.bronze.from("slack_messages").select("message_ts").eq("channel_id", channelId).in("message_ts", part)) ?? []
    );
    return new Set(rows.map((r) => r.message_ts));
  }

  async newestTimestamp(channelId: string) {
    const row = must(await this.bronze.from("slack_messages").select("message_ts").eq("channel_id", channelId).order("message_ts", { ascending: false }).limit(1).maybeSingle());
    return row?.message_ts ?? null;
  }

  async authorsByTs(channelId: string, messageTs: string[]) {
    const rows = await inChunks(messageTs, AUTHOR_CHUNK, async (part) =>
      must(await this.bronze.from("slack_messages").select("message_ts, user_id").eq("channel_id", channelId).in("message_ts", part)) ?? []
    );
    return new Map(rows.map((r) => [r.message_ts, r.user_id]));
  }

  private get files() {
    return this.bronze.from("slack_files");
  }

  async recordFiles(files: NewSlackFile[]) {
    for (const part of chunk(files, 500)) {
      // ignoreDuplicates: never overwrite a row that already has its storage_path.
      must(await this.files.upsert(part, { onConflict: "file_id", ignoreDuplicates: true }));
    }
  }

  async replaceFile(file: NewSlackFile) {
    must(await this.files.upsert(file, { onConflict: "file_id" }));
  }

  async fileById(fileId: string) {
    return must(await this.files.select(FILE_COLUMNS).eq("file_id", fileId).maybeSingle()) as SlackFile | null;
  }

  async updateFile(fileId: string, change: SlackFileChange) {
    must(await this.files.update(change).eq("file_id", fileId));
  }

  async filesWithoutCopy() {
    return fetchAllRows<SlackFile>((first, last) =>
      asPage<SlackFile>(this.files.select(FILE_COLUMNS).is("storage_path", null).order("message_ts").order("file_id").range(first, last))
    );
  }

  async liveFilesSince(oldestMessageTs: string) {
    return fetchAllRows<{ file_id: string; channel_id: string; message_ts: string }>((first, last) =>
      asPage<{ file_id: string; channel_id: string; message_ts: string }>(
        this.files.select("file_id, channel_id, message_ts").is("deleted_at", null).gte("message_ts", oldestMessageTs).order("file_id").range(first, last)
      )
    );
  }

  async deletedFilesWithBytes(limit: number) {
    const rows = must(
      await this.files.select("file_id, storage_path").not("deleted_at", "is", null).not("storage_path", "is", null).order("deleted_at").order("file_id").limit(limit)
    );
    return (rows ?? []) as { file_id: string; storage_path: string }[];
  }

  async threadMessages(channelId: string, threadTs: string[]) {
    const rows: { thread_ts: string; message_ts: string }[] = [];
    for (const part of chunk(threadTs, TS_CHUNK)) {
      rows.push(
        ...(await fetchAllRows<{ thread_ts: string; message_ts: string }>((first, last) =>
          asPage<{ thread_ts: string; message_ts: string }>(
            this.bronze
              .from("slack_messages")
              .select("thread_ts, message_ts")
              .eq("channel_id", channelId)
              .in("thread_ts", part)
              .is("deleted_at", null)
              .order("message_ts")
              .range(first, last)
          )
        ))
      );
    }
    return rows;
  }

  async hasLiveActivityBetween(from: string, to: string) {
    const live = (table: "slack_messages" | "slack_reactions") =>
      this.bronze.from(table).select("message_ts").gte("occurred_at", from).lte("occurred_at", to).is("deleted_at", null).limit(1);
    const [messages, reactions] = await Promise.all([live("slack_messages"), live("slack_reactions")]);
    return (must(messages)?.length ?? 0) > 0 || (must(reactions)?.length ?? 0) > 0;
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemorySlackMessageRepository implements SlackMessageRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private memberWritten(m: SlackMessageSeed) {
    return !m.deleted_at && (m.message_type == null || !SYSTEM_SUBTYPES.includes(m.message_type));
  }

  private byTime<T extends { occurred_at: string; channel_id: string; message_ts?: string }>(rows: T[]) {
    return [...rows].sort(
      (a, b) =>
        (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : 0) ||
        (a.channel_id < b.channel_id ? -1 : a.channel_id > b.channel_id ? 1 : 0) ||
        ((a.message_ts ?? "") < (b.message_ts ?? "") ? -1 : (a.message_ts ?? "") > (b.message_ts ?? "") ? 1 : 0)
    );
  }

  async messageCountsByUser() {
    const counts = new Map<string, number>();
    for (const m of this.data.slackMessages) if (m.user_id) counts.set(m.user_id, (counts.get(m.user_id) ?? 0) + 1);
    return counts;
  }

  async lastImportedAt() {
    const times = [...this.data.slackMessages, ...this.data.slackReactions].map((r) => r.imported_at).filter((t): t is string => !!t);
    return times.sort().pop() ?? null;
  }

  async liveMessagesBetween(from: string, to: string) {
    return this.byTime(
      this.data.slackMessages
        .filter((m) => this.memberWritten(m) && m.occurred_at >= from && m.occurred_at <= to)
        .map((m) => ({
          channel_id: m.channel_id,
          channel_name: m.channel_name ?? null,
          occurred_at: m.occurred_at,
          deleted_at: m.deleted_at ?? null,
          user_id: m.user_id,
          thread_ts: m.thread_ts ?? null,
          message_ts: m.message_ts,
        }))
    ).map(({ message_ts: _ts, ...row }) => row);
  }

  async liveReactionsBetween(from: string, to: string) {
    return this.byTime(
      this.data.slackReactions
        .filter((r) => !r.deleted_at && r.occurred_at >= from && r.occurred_at <= to)
        .map((r) => ({
          channel_id: r.channel_id,
          channel_name: r.channel_name ?? null,
          occurred_at: r.occurred_at,
          deleted_at: r.deleted_at ?? null,
          user_id: r.user_id,
          reaction: r.reaction,
          message_ts: r.message_ts,
        }))
    ).map(({ message_ts: _ts, ...row }) => row);
  }

  async upsertMessages(messages: NewSlackMessage[]) {
    for (const m of messages) {
      const { id: _id, ...fields } = m;
      const existing = this.data.slackMessages.find((x) => x.channel_id === m.channel_id && x.message_ts === m.message_ts);
      if (existing) Object.assign(existing, fields);
      else this.data.slackMessages.push({ ...fields });
    }
  }

  async upsertReactions(reactions: NewSlackReaction[]) {
    for (const r of reactions) {
      const { id: _id, ...fields } = r;
      const existing = this.data.slackReactions.find((x) => sameReaction(x, r));
      if (existing) Object.assign(existing, fields);
      else this.data.slackReactions.push({ ...fields });
    }
  }

  async editMessage(channelId: string, messageTs: string, edit: SlackMessageEdit) {
    const m = this.data.slackMessages.find((x) => x.channel_id === channelId && x.message_ts === messageTs);
    if (m) Object.assign(m, edit);
  }

  async markMessagesDeleted(channelId: string, messageTs: string[], at: string) {
    for (const m of this.data.slackMessages) {
      if (m.channel_id === channelId && messageTs.includes(m.message_ts) && !m.deleted_at) m.deleted_at = at;
    }
  }

  async markReactionRemoved(key: ReactionKey, at: string) {
    for (const r of this.data.slackReactions) {
      if (sameReaction(r, key) && !r.deleted_at) r.deleted_at = at;
    }
  }

  async storedMessagesBetween(from: string, to: string) {
    return this.data.slackMessages
      .filter((m) => !m.deleted_at && m.occurred_at >= from && m.occurred_at <= to)
      .map((m) => ({ channel_id: m.channel_id, message_ts: m.message_ts, thread_ts: m.thread_ts ?? null, occurred_at: m.occurred_at }))
      .sort(byKeyThenId((m) => m.channel_id, (m) => m.message_ts));
  }

  async liveReactionsOn(channelId: string, messageTs: string[]) {
    return this.data.slackReactions
      .filter((r) => r.channel_id === channelId && messageTs.includes(r.message_ts) && !r.deleted_at)
      .map(({ channel_id, message_ts, reaction, user_id }) => ({ channel_id, message_ts, reaction, user_id }))
      .sort(byKeyThenId((r) => `${r.message_ts}|${r.reaction}`, (r) => r.user_id));
  }

  async storedTimestamps(channelId: string, messageTs: string[]) {
    const wanted = new Set(messageTs);
    return new Set(this.data.slackMessages.filter((m) => m.channel_id === channelId && wanted.has(m.message_ts)).map((m) => m.message_ts));
  }

  async newestTimestamp(channelId: string) {
    const all = this.data.slackMessages.filter((m) => m.channel_id === channelId).map((m) => m.message_ts);
    return all.length > 0 ? all.reduce((newest, ts) => (ts > newest ? ts : newest)) : null;
  }

  async authorsByTs(channelId: string, messageTs: string[]) {
    const wanted = new Set(messageTs);
    return new Map(this.data.slackMessages.filter((m) => m.channel_id === channelId && wanted.has(m.message_ts)).map((m) => [m.message_ts, m.user_id]));
  }

  private fileRow(f: SlackFileSeed): SlackFile {
    return { name: null, mimetype: null, size_bytes: null, storage_path: null, copy_error: null, deleted_at: null, raw_payload: {}, ...f };
  }

  async recordFiles(files: NewSlackFile[]) {
    for (const f of files) {
      if (!this.data.slackFiles.some((x) => x.file_id === f.file_id)) this.data.slackFiles.push({ ...f });
    }
  }

  async replaceFile(file: NewSlackFile) {
    const existing = this.data.slackFiles.find((x) => x.file_id === file.file_id);
    if (existing) Object.assign(existing, file);
    else this.data.slackFiles.push({ ...file });
  }

  async fileById(fileId: string) {
    const f = this.data.slackFiles.find((x) => x.file_id === fileId);
    return f ? this.fileRow(f) : null;
  }

  async updateFile(fileId: string, change: SlackFileChange) {
    const f = this.data.slackFiles.find((x) => x.file_id === fileId);
    if (f) Object.assign(f, change);
  }

  async filesWithoutCopy() {
    return this.data.slackFiles
      .filter((f) => !f.storage_path)
      .map((f) => this.fileRow(f))
      .sort(byKeyThenId((f) => f.message_ts, (f) => f.file_id));
  }

  async liveFilesSince(oldestMessageTs: string) {
    return this.data.slackFiles
      .filter((f) => !f.deleted_at && f.message_ts >= oldestMessageTs)
      .map(({ file_id, channel_id, message_ts }) => ({ file_id, channel_id, message_ts }))
      .sort((a, b) => compareText(a.file_id, b.file_id));
  }

  async deletedFilesWithBytes(limit: number) {
    return this.data.slackFiles
      .filter((f) => f.deleted_at && f.storage_path)
      .sort(byKeyThenId((f) => f.deleted_at as string, (f) => f.file_id))
      .slice(0, limit)
      .map((f) => ({ file_id: f.file_id, storage_path: f.storage_path as string }));
  }

  async threadMessages(channelId: string, threadTs: string[]) {
    return this.data.slackMessages
      .filter((m) => m.channel_id === channelId && !m.deleted_at && m.thread_ts != null && threadTs.includes(m.thread_ts))
      .map((m) => ({ thread_ts: m.thread_ts as string, message_ts: m.message_ts }))
      .sort(byKeyThenId((m) => m.message_ts, (m) => m.thread_ts));
  }

  async hasLiveActivityBetween(from: string, to: string) {
    const inRange = (r: { occurred_at: string; deleted_at?: string | null }) => !r.deleted_at && r.occurred_at >= from && r.occurred_at <= to;
    return this.data.slackMessages.some(inRange) || this.data.slackReactions.some(inRange);
  }

  async liveMessageTimes() {
    return this.byTime(this.data.slackMessages.filter((m) => this.memberWritten(m)).map((m) => ({ channel_id: m.channel_id, occurred_at: m.occurred_at, message_ts: m.message_ts }))).map(
      ({ message_ts: _ts, ...row }) => row
    );
  }
}
