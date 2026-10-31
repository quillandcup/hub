import { fetchAllRows } from "@/lib/supabase/paginate";
import { asPage, byKeyThenId, inChunks, must } from "./query";
import type { Database } from "./database.types";
import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";

type ChannelTable = Database["bronze"]["Tables"]["slack_channels"];

/**
 * A Slack conversation as the import keeps it (`bronze.slack_channels`: channels and group DMs), without the
 * raw payload, which signed-in users can't read (column grants), so every read names these columns.
 */
export type SlackChannel = Pick<
  ChannelTable["Row"],
  "channel_id" | "name" | "is_private" | "is_archived" | "is_mpim" | "member_count" | "created" | "imported_at"
>;

/** A channel as the in-memory dataset keeps it: the id and name, and whatever else a test names. */
export type SlackChannelSeed = Pick<SlackChannel, "channel_id" | "name"> & Partial<Omit<SlackChannel, "channel_id" | "name">>;

const CHANNEL_COLUMNS = "channel_id, name, is_private, is_archived, is_mpim, member_count, created, imported_at";

/** A private channel whose messages staff can't read (`restricted_slack_channels`), as `channel id -> when it was restricted`. */
export type RestrictedChannelSeed = { channel_id: string; name?: string | null; created_at: string };

/** A Slack user the admins skip when matching Slack accounts to members (`ignored_slack_users`). */
export type IgnoredSlackUserSeed = { user_id: string; reason?: string | null; created_at?: string | null };

/**
 * The Bronze copy of the Slack workspace's structure: its channels and group DMs, and the admin decisions that
 * hang off them (which private channels staff can't read, which Slack users are ignored). Messages are
 * `SlackMessageRepository`'s. Reads throw on a database error and page past 1000 rows; a lookup that finds
 * nothing returns null.
 */
export interface SlackWorkspaceRepository {
  /** Every conversation, by name then id. */
  channels(): Promise<SlackChannel[]>;
  /** One conversation, or null. */
  channelById(channelId: string): Promise<SlackChannel | null>;
  /** The id of the conversation with this name (the lowest id if several), or null. */
  channelIdByName(name: string): Promise<string | null>;
  /** channel id -> name for the public channels among these ids (those that exist and have a name). Chunked. */
  publicChannelNames(channelIds: string[]): Promise<Map<string, string>>;

  /** The Slack users admins chose to skip. */
  ignoredUserIds(): Promise<Set<string>>;
  /** Skips a Slack user from now on. Already skipped is fine. */
  ignoreUser(userId: string, reason: string): Promise<void>;

  /** Private channels staff can't read: channel id -> when they were restricted. */
  restrictedChannels(): Promise<Map<string, string>>;
  /** Stops staff reading a channel's messages. Already restricted is fine. */
  restrictChannel(channelId: string, name: string): Promise<void>;
  /** Lets staff read a channel's messages again. */
  unrestrictChannel(channelId: string): Promise<void>;
}

const NAME_CHUNK = 200;
/** Postgres' unique violation: "already there". */
const UNIQUE_VIOLATION = "23505";

export class SupabaseSlackWorkspaceRepository implements SlackWorkspaceRepository {
  constructor(private readonly db: Db) {}

  private get channelsTable() {
    return this.db.schema("bronze").from("slack_channels");
  }

  async channels() {
    return fetchAllRows<SlackChannel>((from, to) =>
      asPage<SlackChannel>(this.channelsTable.select(CHANNEL_COLUMNS).order("name").order("channel_id").range(from, to))
    );
  }

  async channelById(channelId: string) {
    return must(await this.channelsTable.select(CHANNEL_COLUMNS).eq("channel_id", channelId).maybeSingle());
  }

  async channelIdByName(name: string) {
    const data = must(await this.channelsTable.select("channel_id").eq("name", name).order("channel_id").limit(1).maybeSingle());
    return data?.channel_id ?? null;
  }

  async publicChannelNames(channelIds: string[]) {
    const rows = await inChunks(channelIds, NAME_CHUNK, async (part) =>
      must(await this.channelsTable.select("channel_id, name").in("channel_id", part).eq("is_private", false)) ?? []
    );
    return new Map(rows.filter((c) => c.name).map((c) => [c.channel_id, c.name]));
  }

  async ignoredUserIds() {
    const rows = await fetchAllRows<{ user_id: string }>((from, to) =>
      asPage<{ user_id: string }>(this.db.from("ignored_slack_users").select("user_id").order("user_id").range(from, to))
    );
    return new Set(rows.map((r) => r.user_id));
  }

  async ignoreUser(userId: string, reason: string) {
    const { error } = await this.db.from("ignored_slack_users").insert({ user_id: userId, reason });
    if (error && error.code !== UNIQUE_VIOLATION) throw new Error(error.message);
  }

  async restrictedChannels() {
    const rows = await fetchAllRows<{ channel_id: string; created_at: string }>((from, to) =>
      asPage<{ channel_id: string; created_at: string }>(
        this.db.from("restricted_slack_channels").select("channel_id, created_at").order("channel_id").range(from, to)
      )
    );
    return new Map(rows.map((r) => [r.channel_id, r.created_at]));
  }

  async restrictChannel(channelId: string, name: string) {
    const { error } = await this.db.from("restricted_slack_channels").insert({ channel_id: channelId, name });
    if (error && error.code !== UNIQUE_VIOLATION) throw new Error(error.message);
  }

  async unrestrictChannel(channelId: string) {
    const { error } = await this.db.from("restricted_slack_channels").delete().eq("channel_id", channelId);
    if (error) throw new Error(error.message);
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemorySlackWorkspaceRepository implements SlackWorkspaceRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private full(c: SlackChannelSeed): SlackChannel {
    return { is_private: null, is_archived: null, is_mpim: false, member_count: null, created: null, imported_at: "1970-01-01T00:00:00.000Z", ...c };
  }

  async channels() {
    return this.data.slackChannels.map((c) => this.full(c)).sort(byKeyThenId((c) => c.name, (c) => c.channel_id));
  }

  async channelById(channelId: string) {
    const c = this.data.slackChannels.find((x) => x.channel_id === channelId);
    return c ? this.full(c) : null;
  }

  async channelIdByName(name: string) {
    const ids = this.data.slackChannels.filter((c) => c.name === name).map((c) => c.channel_id);
    return ids.length > 0 ? ids.reduce((lowest, id) => (id < lowest ? id : lowest)) : null;
  }

  async publicChannelNames(channelIds: string[]) {
    const wanted = new Set(channelIds);
    return new Map(
      this.data.slackChannels
        // As in SQL, `is_private = false` does not match a null.
        .filter((c) => wanted.has(c.channel_id) && c.is_private === false && c.name)
        .map((c) => [c.channel_id, c.name])
    );
  }

  async ignoredUserIds() {
    return new Set(this.data.ignoredSlackUsers.map((u) => u.user_id));
  }

  async ignoreUser(userId: string, reason: string) {
    if (!this.data.ignoredSlackUsers.some((u) => u.user_id === userId)) this.data.ignoredSlackUsers.push({ user_id: userId, reason });
  }

  async restrictedChannels() {
    return new Map(this.data.restrictedSlackChannels.map((r) => [r.channel_id, r.created_at]));
  }

  async restrictChannel(channelId: string, name: string) {
    if (!this.data.restrictedSlackChannels.some((r) => r.channel_id === channelId)) {
      this.data.restrictedSlackChannels.push({ channel_id: channelId, name, created_at: new Date().toISOString() });
    }
  }

  async unrestrictChannel(channelId: string) {
    this.data.restrictedSlackChannels = this.data.restrictedSlackChannels.filter((r) => r.channel_id !== channelId);
  }
}
