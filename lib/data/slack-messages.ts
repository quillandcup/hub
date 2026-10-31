import { SLACK_SYSTEM_SUBTYPES } from "@/lib/slack-messages";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { asPage, must } from "./query";
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
}

const messageOrder = <Q extends { order(column: string): Q }>(q: Q) => q.order("occurred_at").order("channel_id").order("message_ts");

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

  async liveMessageTimes() {
    return this.byTime(this.data.slackMessages.filter((m) => this.memberWritten(m)).map((m) => ({ channel_id: m.channel_id, occurred_at: m.occurred_at, message_ts: m.message_ts }))).map(
      ({ message_ts: _ts, ...row }) => row
    );
  }
}
