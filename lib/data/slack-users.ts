import { SLACKBOT_USER_ID } from "@/lib/slack-matching";
import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import { upsertInChunks } from "./query";
import type { Database } from "./database.types";
import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";

type SlackUserTable = Database["bronze"]["Tables"]["slack_users"];

/**
 * A Slack user as the import keeps it (`bronze.slack_users`), without the raw payload, which signed-in
 * users can't read (column grants), so every read names these columns instead of using `*`.
 */
export type SlackUserProfile = Pick<SlackUserTable["Row"], "user_id" | "email" | "real_name" | "display_name" | "name" | "image_url" | "is_bot" | "is_deleted">;

/** A Slack user as the in-memory dataset keeps it: the id, and whatever else a test names. */
export type SlackUserSeed = Pick<SlackUserProfile, "user_id"> & Partial<Omit<SlackUserProfile, "user_id">>;

/** What the import writes: the CSV's columns (the raw payload included) plus the sync time. */
export type NewSlackUser = SlackUserTable["Insert"];

const COLUMNS = "user_id, email, real_name, display_name, name, image_url, is_bot, is_deleted";
const ID_CHUNK = 100;

/**
 * The Bronze copy of the workspace's Slack users: who they are (name, email, avatar) and whether they
 * are bots or deactivated. Matching them to members is the matchers' job (lib/slack-matching.ts);
 * this is where they are read from. Reads throw on a database error and page past 1000 rows.
 */
export interface SlackUserRepository {
  /** Every Slack user, by id. `excludeSlackbot` leaves out Slackbot; `excludeBots` leaves out anything flagged as a bot. */
  list(filter?: { excludeSlackbot?: boolean; excludeBots?: boolean }): Promise<SlackUserProfile[]>;
  /** One Slack user, or null. */
  byId(userId: string): Promise<SlackUserProfile | null>;
  /** These Slack users (those that exist). Chunked. */
  byIds(userIds: string[]): Promise<SlackUserProfile[]>;
  /** The Slack users with one of these email addresses (exact match; `excludeBots` leaves out bots). Chunked. */
  byEmails(emails: string[], filter?: { excludeBots?: boolean }): Promise<SlackUserProfile[]>;
  /** Adds users, or replaces the ones with the same Slack id (an import is idempotent). */
  upsert(users: NewSlackUser[]): Promise<void>;
}

export class SupabaseSlackUserRepository implements SlackUserRepository {
  constructor(private readonly db: Db) {}

  private get table() {
    return this.db.schema("bronze").from("slack_users");
  }

  async list({ excludeSlackbot = false, excludeBots = false }: { excludeSlackbot?: boolean; excludeBots?: boolean } = {}) {
    return fetchAllRows<SlackUserProfile>((from, to) => {
      let query = this.table.select(COLUMNS);
      if (excludeBots) query = query.eq("is_bot", false);
      if (excludeSlackbot) query = query.neq("user_id", SLACKBOT_USER_ID);
      return query.order("user_id").range(from, to) as unknown as PromiseLike<{ data: SlackUserProfile[] | null; error: { message: string } | null }>;
    });
  }

  async byId(userId: string) {
    const { data, error } = await this.table.select(COLUMNS).eq("user_id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async byIds(userIds: string[]) {
    const rows: SlackUserProfile[] = [];
    for (const part of chunk([...new Set(userIds)], ID_CHUNK)) {
      const { data, error } = await this.table.select(COLUMNS).in("user_id", part);
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
    }
    return rows;
  }

  async byEmails(emails: string[], { excludeBots = false }: { excludeBots?: boolean } = {}) {
    const rows: SlackUserProfile[] = [];
    for (const part of chunk([...new Set(emails)], ID_CHUNK)) {
      let query = this.table.select(COLUMNS).in("email", part);
      if (excludeBots) query = query.eq("is_bot", false);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
    }
    return rows;
  }

  async upsert(users: NewSlackUser[]) {
    if (users.length === 0) return;
    // Small chunks, two at a time: each upsert is one statement under the API role's 8s statement timeout.
    await upsertInChunks(this.table, users, "user_id", 100, 2);
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemorySlackUserRepository implements SlackUserRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private full(u: SlackUserSeed): SlackUserProfile {
    return { email: null, real_name: null, display_name: null, name: null, image_url: null, is_bot: null, is_deleted: null, ...u };
  }

  private byUserId(rows: SlackUserProfile[]) {
    return [...rows].sort((a, b) => (a.user_id < b.user_id ? -1 : 1));
  }

  async list({ excludeSlackbot = false, excludeBots = false }: { excludeSlackbot?: boolean; excludeBots?: boolean } = {}) {
    return this.byUserId(
      this.data.slackUsers
        .map((u) => this.full(u))
        // As in SQL, `is_bot = false` does not match a null.
        .filter((u) => (!excludeBots || u.is_bot === false) && (!excludeSlackbot || u.user_id !== SLACKBOT_USER_ID))
    );
  }

  async byId(userId: string) {
    const u = this.data.slackUsers.find((x) => x.user_id === userId);
    return u ? this.full(u) : null;
  }

  async byIds(userIds: string[]) {
    const wanted = new Set(userIds);
    return this.data.slackUsers.filter((u) => wanted.has(u.user_id)).map((u) => this.full(u));
  }

  async byEmails(emails: string[], { excludeBots = false }: { excludeBots?: boolean } = {}) {
    const wanted = new Set(emails);
    return this.data.slackUsers.map((u) => this.full(u)).filter((u) => u.email !== null && wanted.has(u.email) && (!excludeBots || u.is_bot === false));
  }

  async upsert(users: NewSlackUser[]) {
    for (const u of users) {
      const existing = this.data.slackUsers.find((x) => x.user_id === u.user_id);
      const { raw_payload: _raw, id: _id, imported_at: _at, ...profile } = u;
      if (existing) Object.assign(existing, profile);
      else this.data.slackUsers.push(profile);
    }
  }
}
