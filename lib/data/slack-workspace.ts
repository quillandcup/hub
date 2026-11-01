import { fetchAllRows } from "@/lib/supabase/paginate";
import { chunk } from "@/lib/supabase/paginate";
import { asJson } from "./json";
import { byKeyThenId, compareText, inChunks, must, sortByKey, upsertInChunks } from "./query";
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

/** What the import writes for a conversation: the Slack fields (the raw payload included) plus the sync time. */
export type NewSlackChannel = ChannelTable["Insert"];

/** Who is in a conversation now: a row per user, `left_at` set once they have gone. */
export type SlackChannelMembership = Pick<Database["bronze"]["Tables"]["slack_channel_members"]["Row"], "channel_id" | "user_id" | "left_at" | "first_seen_at">;

/** A membership as the in-memory dataset keeps it. */
export type SlackChannelMembershipSeed = Pick<SlackChannelMembership, "channel_id" | "user_id"> & Partial<SlackChannelMembership> & { imported_at?: string };

/** One join or leave in the append-only history (`bronze.slack_channel_member_events`), as the capture writes it. */
export interface SlackMemberEvent {
  channel_id: string;
  user_id: string;
  event: "joined" | "left";
  occurred_at: string;
  source: "history_notice" | "webhook" | "member_list";
  inviter_user_id?: string | null;
  slack_ts?: string | null;
  raw_payload?: unknown;
}

/** An event as the in-memory dataset keeps it (with the id order the database would give it). */
export type SlackMemberEventSeed = Required<Pick<SlackMemberEvent, "channel_id" | "user_id" | "event" | "occurred_at" | "source">> & {
  id?: string;
  inviter_user_id?: string | null;
  slack_ts?: string | null;
  raw_payload?: unknown;
};

/** What the emoji sync writes: `bronze.slack_custom_emoji`'s columns. */
export type NewSlackEmoji = Database["bronze"]["Tables"]["slack_custom_emoji"]["Insert"];

/** A custom emoji as the in-memory dataset keeps it. */
export type SlackEmojiSeed = Pick<NewSlackEmoji, "name"> & Partial<Omit<NewSlackEmoji, "name">>;

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

  /** Adds conversations, or replaces the ones with the same Slack id (an import is idempotent). Chunked. */
  upsertChannels(channels: NewSlackChannel[]): Promise<void>;

  /** Every conversation's members, current and past, by channel then user. */
  memberships(): Promise<SlackChannelMembership[]>;
  /** Adds members, or brings back ones who had left (`left_at` cleared). Chunked. */
  upsertMemberships(rows: { channel_id: string; user_id: string; left_at: null; imported_at: string }[]): Promise<void>;
  /** Marks these users as having left a channel at `at`, whether or not they were already marked. Chunked. */
  markMembersLeft(channelId: string, userIds: string[], at: string): Promise<void>;
  /** Marks one user as having left, if they are still in. */
  markMemberLeft(channelId: string, userId: string, at: string): Promise<void>;

  /** Appends joins and leaves. A repeat of the same event (channel, user, kind, time, source) is ignored. Chunked. */
  recordMemberEvents(events: SlackMemberEvent[]): Promise<void>;
  /** The latest recorded event per channel and user: whether the log has them in or out. */
  lastMemberEvents(): Promise<Map<string, Map<string, "joined" | "left">>>;

  /** Adds custom emoji, or replaces the ones with the same name. Chunked. */
  upsertEmoji(emoji: NewSlackEmoji[]): Promise<void>;
  /** The names of the emoji not marked removed, by name. */
  liveEmojiNames(): Promise<string[]>;
  /** The live emoji with these names: image and alias target. Chunked. */
  emojiByNames(names: string[]): Promise<{ name: string; image_url: string | null; alias_for: string | null }[]>;
  /** Marks emoji removed at `at` (those not already). Chunked. */
  markEmojiRemoved(names: string[], at: string): Promise<void>;

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
const USER_CHUNK = 100;
const EPOCH = "1970-01-01T00:00:00.000Z";
const WRITE_CHUNK = 500;

const eventKey = (e: Pick<SlackMemberEvent, "channel_id" | "user_id" | "event" | "occurred_at" | "source">) =>
  `${e.channel_id}|${e.user_id}|${e.event}|${e.occurred_at}|${e.source}`;

/** The last event of each user in each channel, from rows already in order. */
function lastEventPerUser(rows: { channel_id: string; user_id: string; event: "joined" | "left" }[]) {
  const last = new Map<string, Map<string, "joined" | "left">>();
  for (const row of rows) {
    if (!last.has(row.channel_id)) last.set(row.channel_id, new Map());
    last.get(row.channel_id)!.set(row.user_id, row.event);
  }
  return last;
}
/** Postgres' unique violation: "already there". */
const UNIQUE_VIOLATION = "23505";

export class SupabaseSlackWorkspaceRepository implements SlackWorkspaceRepository {
  constructor(private readonly db: Db) {}

  private get channelsTable() {
    return this.db.schema("bronze").from("slack_channels");
  }

  async channels() {
    return fetchAllRows<SlackChannel>((from, to) =>
      this.channelsTable.select(CHANNEL_COLUMNS).order("name").order("channel_id").range(from, to)
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

  async upsertChannels(channels: NewSlackChannel[]) {
    // Small chunks, two at a time: each upsert is one statement under the API role's 8s statement timeout.
    await upsertInChunks(this.channelsTable, channels, "channel_id", 100, 2);
  }

  private get membersTable() {
    return this.db.schema("bronze").from("slack_channel_members");
  }

  async memberships() {
    return fetchAllRows<SlackChannelMembership>((from, to) =>
      this.membersTable.select("channel_id, user_id, left_at, first_seen_at").order("channel_id").order("user_id").range(from, to)
    );
  }

  async upsertMemberships(rows: { channel_id: string; user_id: string; left_at: null; imported_at: string }[]) {
    await upsertInChunks(this.membersTable, rows, "channel_id,user_id", WRITE_CHUNK);
  }

  async markMembersLeft(channelId: string, userIds: string[], at: string) {
    for (const part of chunk(userIds, USER_CHUNK)) {
      must(await this.membersTable.update({ left_at: at, imported_at: at }).eq("channel_id", channelId).in("user_id", part));
    }
  }

  async markMemberLeft(channelId: string, userId: string, at: string) {
    must(await this.membersTable.update({ left_at: at, imported_at: at }).eq("channel_id", channelId).eq("user_id", userId).is("left_at", null));
  }

  async recordMemberEvents(events: SlackMemberEvent[]) {
    // One statement can't carry the same key twice.
    const unique = new Map<string, SlackMemberEvent>();
    for (const e of events) unique.set(eventKey(e), e);
    const rows = [...unique.values()].map((e) => ({
      channel_id: e.channel_id,
      user_id: e.user_id,
      event: e.event,
      occurred_at: e.occurred_at,
      source: e.source,
      inviter_user_id: e.inviter_user_id ?? null,
      slack_ts: e.slack_ts ?? null,
      raw_payload: asJson(e.raw_payload ?? {}),
    }));
    for (const part of chunk(rows, WRITE_CHUNK)) {
      must(
        await this.db
          .schema("bronze")
          .from("slack_channel_member_events")
          .upsert(part, { onConflict: "channel_id,user_id,event,occurred_at,source", ignoreDuplicates: true })
      );
    }
  }

  async lastMemberEvents() {
    const rows = await fetchAllRows<{ channel_id: string; user_id: string; event: "joined" | "left" }>((from, to) =>
      this.db.schema("bronze").from("slack_channel_member_events").select("channel_id, user_id, event").order("occurred_at").order("id").range(from, to)
        .overrideTypes<{ channel_id: string; user_id: string; event: "joined" | "left" }[], { merge: false }>() // text column the importer limits to these two
    );
    return lastEventPerUser(rows);
  }

  private get emojiTable() {
    return this.db.schema("bronze").from("slack_custom_emoji");
  }

  async upsertEmoji(emoji: NewSlackEmoji[]) {
    await upsertInChunks(this.emojiTable, emoji, "name", WRITE_CHUNK);
  }

  async liveEmojiNames() {
    const rows = await fetchAllRows<{ name: string }>((from, to) =>
      this.emojiTable.select("name").is("deleted_at", null).order("name").range(from, to)
    );
    return rows.map((r) => r.name);
  }

  async emojiByNames(names: string[]) {
    const rows = await inChunks(names, NAME_CHUNK, async (part) =>
      must(await this.emojiTable.select("name, image_url, alias_for").in("name", part).is("deleted_at", null)) ?? []
    );
    return sortByKey(rows, (r) => r.name);
  }

  async markEmojiRemoved(names: string[], at: string) {
    for (const part of chunk(names, USER_CHUNK)) {
      must(await this.emojiTable.update({ deleted_at: at, imported_at: at }).in("name", part).is("deleted_at", null));
    }
  }

  async ignoredUserIds() {
    const rows = await fetchAllRows<{ user_id: string }>((from, to) =>
      this.db.from("ignored_slack_users").select("user_id").order("user_id").range(from, to)
    );
    return new Set(rows.map((r) => r.user_id));
  }

  async ignoreUser(userId: string, reason: string) {
    const { error } = await this.db.from("ignored_slack_users").insert({ user_id: userId, reason });
    if (error && error.code !== UNIQUE_VIOLATION) throw new Error(error.message);
  }

  async restrictedChannels() {
    const rows = await fetchAllRows<{ channel_id: string; created_at: string }>((from, to) =>
      this.db.from("restricted_slack_channels").select("channel_id, created_at").order("channel_id").range(from, to)
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

  async upsertChannels(channels: NewSlackChannel[]) {
    for (const c of channels) {
      const { raw_payload: _raw, id: _id, ...fields } = c;
      const existing = this.data.slackChannels.find((x) => x.channel_id === c.channel_id);
      if (existing) Object.assign(existing, fields);
      else this.data.slackChannels.push(fields);
    }
  }

  async memberships() {
    return this.data.slackChannelMembers
      .map((m) => ({ channel_id: m.channel_id, user_id: m.user_id, left_at: m.left_at ?? null, first_seen_at: m.first_seen_at ?? m.imported_at ?? EPOCH }))
      .sort(byKeyThenId((m) => m.channel_id, (m) => m.user_id));
  }

  async upsertMemberships(rows: { channel_id: string; user_id: string; left_at: null; imported_at: string }[]) {
    for (const r of rows) {
      const existing = this.data.slackChannelMembers.find((m) => m.channel_id === r.channel_id && m.user_id === r.user_id);
      if (existing) Object.assign(existing, { left_at: r.left_at, imported_at: r.imported_at });
      else this.data.slackChannelMembers.push({ ...r, first_seen_at: r.imported_at });
    }
  }

  async markMembersLeft(channelId: string, userIds: string[], at: string) {
    for (const m of this.data.slackChannelMembers) {
      if (m.channel_id === channelId && userIds.includes(m.user_id)) Object.assign(m, { left_at: at, imported_at: at });
    }
  }

  async markMemberLeft(channelId: string, userId: string, at: string) {
    for (const m of this.data.slackChannelMembers) {
      if (m.channel_id === channelId && m.user_id === userId && !m.left_at) Object.assign(m, { left_at: at, imported_at: at });
    }
  }

  async recordMemberEvents(events: SlackMemberEvent[]) {
    for (const e of events) {
      if (this.data.slackMemberEvents.some((x) => eventKey(x) === eventKey(e))) continue;
      this.data.slackMemberEvents.push({ ...e, inviter_user_id: e.inviter_user_id ?? null, slack_ts: e.slack_ts ?? null, raw_payload: e.raw_payload ?? {} });
    }
  }

  async lastMemberEvents() {
    // Oldest first; events at the same time keep the order they were recorded in (the database orders them by id).
    const ordered = this.data.slackMemberEvents.map((e, i) => ({ e, i })).sort((a, b) => compareText(a.e.occurred_at, b.e.occurred_at) || a.i - b.i);
    return lastEventPerUser(ordered.map(({ e }) => e));
  }

  async upsertEmoji(emoji: NewSlackEmoji[]) {
    for (const e of emoji) {
      const existing = this.data.slackCustomEmoji.find((x) => x.name === e.name);
      if (existing) Object.assign(existing, e);
      else this.data.slackCustomEmoji.push({ ...e });
    }
  }

  async liveEmojiNames() {
    return this.data.slackCustomEmoji
      .filter((e) => !e.deleted_at)
      .map((e) => e.name)
      .sort(compareText);
  }

  async emojiByNames(names: string[]) {
    const wanted = new Set(names);
    return this.data.slackCustomEmoji
      .filter((e) => wanted.has(e.name) && !e.deleted_at)
      .map((e) => ({ name: e.name, image_url: e.image_url ?? null, alias_for: e.alias_for ?? null }))
      .sort((a, b) => compareText(a.name, b.name));
  }

  async markEmojiRemoved(names: string[], at: string) {
    for (const e of this.data.slackCustomEmoji) {
      if (names.includes(e.name) && !e.deleted_at) Object.assign(e, { deleted_at: at, imported_at: at });
    }
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
