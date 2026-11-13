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
export type SlackUserProfile = Pick<SlackUserTable["Row"], "user_id" | "email" | "real_name" | "display_name" | "name" | "image_url" | "image_path" | "is_bot" | "is_deleted">;

/** A Slack user as the in-memory dataset keeps it: the id, and whatever else a test names. */
export type SlackUserSeed = Pick<SlackUserProfile, "user_id"> & Partial<Omit<SlackUserProfile, "user_id">> & { copied_from_url?: string | null; workspace_id?: string };

/** What the import writes: the CSV's columns (the raw payload included) plus the sync time. */
export type NewSlackUser = SlackUserTable["Insert"];

const COLUMNS = "user_id, email, real_name, display_name, name, image_url, image_path, is_bot, is_deleted";
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
  /** Users (deactivated ones too: former members still show in the directory and in chat history) with a photo that has no copy yet, or whose photo changed since it was copied; `image_path` is the stale copy, if any. */
  photosToCopy(): Promise<{ user_id: string; image_url: string; image_path: string | null }[]>;
  /** Records our copy of a user's photo, made from `from`. A no-op when the user's image_url has changed since. */
  markPhotoCopied(userId: string, copy: { from: string; path: string }): Promise<void>;
  /** Copies that should not stay: the user no longer has a photo (Slack dropped it). */
  photoCopiesToRemove(): Promise<{ user_id: string; image_path: string }[]>;
  /** Forgets the copy at `path` once its object is removed. A no-op when the user has a different copy now. */
  clearPhotoCopy(userId: string, path: string): Promise<void>;
}

export class SupabaseSlackUserRepository implements SlackUserRepository {
  /** `workspaceId` scopes reads and writes to one Slack workspace; unscoped reads see every workspace, writes land in the primary one. */
  constructor(private readonly db: Db, private readonly workspaceId?: string) {}

  private inScope<Q extends { eq(column: string, value: string): Q }>(query: Q): Q {
    return this.workspaceId ? query.eq("workspace_id", this.workspaceId) : query;
  }

  private get table() {
    return this.db.schema("bronze").from("slack_users");
  }

  async list({ excludeSlackbot = false, excludeBots = false }: { excludeSlackbot?: boolean; excludeBots?: boolean } = {}) {
    return fetchAllRows<SlackUserProfile>((from, to) => {
      let query = this.inScope(this.table.select(COLUMNS));
      if (excludeBots) query = query.eq("is_bot", false);
      if (excludeSlackbot) query = query.neq("user_id", SLACKBOT_USER_ID);
      return query.order("user_id").range(from, to);
    });
  }

  async byId(userId: string) {
    const { data, error } = await this.inScope(this.table.select(COLUMNS)).eq("user_id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async byIds(userIds: string[]) {
    const rows: SlackUserProfile[] = [];
    for (const part of chunk([...new Set(userIds)], ID_CHUNK)) {
      const { data, error } = await this.inScope(this.table.select(COLUMNS)).in("user_id", part);
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
    }
    return rows;
  }

  async byEmails(emails: string[], { excludeBots = false }: { excludeBots?: boolean } = {}) {
    const rows: SlackUserProfile[] = [];
    for (const part of chunk([...new Set(emails)], ID_CHUNK)) {
      let query = this.inScope(this.table.select(COLUMNS)).in("email", part);
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
    await upsertInChunks(this.table, this.workspaceId ? users.map((u) => ({ ...u, workspace_id: this.workspaceId })) : users, this.workspaceId ? "workspace_id,user_id" : "user_id", 100, 2);
  }

  async photosToCopy() {
    const rows = await fetchAllRows<{ user_id: string; image_url: string | null; image_path: string | null; copied_from_url: string | null }>((from, to) =>
      this.inScope(this.table.select("user_id, image_url, image_path, copied_from_url")).not("image_url", "is", null).order("user_id").range(from, to)
    );
    return rows.filter((r) => r.image_url !== r.copied_from_url).map((r) => ({ user_id: r.user_id, image_url: r.image_url as string, image_path: r.image_path }));
  }

  async markPhotoCopied(userId: string, copy: { from: string; path: string }) {
    const { error } = await this.inScope(this.table.update({ image_path: copy.path, copied_from_url: copy.from })).eq("user_id", userId).eq("image_url", copy.from);
    if (error) throw new Error(error.message);
  }

  async photoCopiesToRemove() {
    const rows = await fetchAllRows<{ user_id: string; image_path: string | null; image_url: string | null }>((from, to) =>
      this.inScope(this.table.select("user_id, image_path, image_url")).not("image_path", "is", null).order("user_id").range(from, to)
    );
    return rows.filter((r) => r.image_url === null).map((r) => ({ user_id: r.user_id, image_path: r.image_path as string }));
  }

  async clearPhotoCopy(userId: string, path: string) {
    const { error } = await this.inScope(this.table.update({ image_path: null, copied_from_url: null })).eq("user_id", userId).eq("image_path", path);
    if (error) throw new Error(error.message);
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemorySlackUserRepository implements SlackUserRepository {
  constructor(private readonly data: InMemoryDataset, private readonly workspaceId?: string) {}
  /** An unscoped twin sees every workspace; a scoped one only its own. A seed row with no workspace belongs to the primary one. */
  private own<T extends { workspace_id?: string | null }>(rows: T[]): T[] {
    if (!this.workspaceId) return rows;
    const primary = this.data.primarySlackWorkspaceId();
    return rows.filter((r) => (r.workspace_id ?? primary) === this.workspaceId);
  }

  /** The workspace a write lands in: the scope, else the primary workspace (as the column default does). */
  private ws(): string {
    return this.workspaceId ?? this.data.primarySlackWorkspaceId();
  }


  /** The workspace a row belongs to (a seed row with none is in the primary one). */
  private wsOf(row: { workspace_id?: string | null }): string {
    return row.workspace_id ?? this.data.primarySlackWorkspaceId();
  }

  /** The workspace an incoming row is written to: its own, else the scope, else the primary one. */
  private target(row: { workspace_id?: string | null }): string {
    return row.workspace_id ?? this.ws();
  }

  /** The rows a write matches against: this workspace's, even when unscoped. */
  private mine<T extends { workspace_id?: string | null }>(rows: T[]): T[] {
    const primary = this.data.primarySlackWorkspaceId();
    return rows.filter((r) => (r.workspace_id ?? primary) === this.ws());
  }


  private full(u: SlackUserSeed): SlackUserProfile {
    return { email: null, real_name: null, display_name: null, name: null, image_url: null, image_path: null, is_bot: null, is_deleted: null, ...u };
  }

  private byUserId(rows: SlackUserProfile[]) {
    return [...rows].sort((a, b) => (a.user_id < b.user_id ? -1 : 1));
  }

  async list({ excludeSlackbot = false, excludeBots = false }: { excludeSlackbot?: boolean; excludeBots?: boolean } = {}) {
    return this.byUserId(
      this.own(this.data.slackUsers)
        .map((u) => this.full(u))
        // As in SQL, `is_bot = false` does not match a null.
        .filter((u) => (!excludeBots || u.is_bot === false) && (!excludeSlackbot || u.user_id !== SLACKBOT_USER_ID))
    );
  }

  async byId(userId: string) {
    const u = this.own(this.data.slackUsers).find((x) => x.user_id === userId);
    return u ? this.full(u) : null;
  }

  async byIds(userIds: string[]) {
    const wanted = new Set(userIds);
    return this.own(this.data.slackUsers).filter((u) => wanted.has(u.user_id)).map((u) => this.full(u));
  }

  async byEmails(emails: string[], { excludeBots = false }: { excludeBots?: boolean } = {}) {
    const wanted = new Set(emails);
    return this.own(this.data.slackUsers).map((u) => this.full(u)).filter((u) => u.email !== null && wanted.has(u.email) && (!excludeBots || u.is_bot === false));
  }

  async upsert(users: NewSlackUser[]) {
    for (const u of users) {
      const existing = this.data.slackUsers.find((x) => this.wsOf(x) === this.target(u) && x.user_id === u.user_id);
      const { raw_payload: _raw, id: _id, imported_at: _at, ...profile } = u;
      if (existing) Object.assign(existing, profile);
      else this.data.slackUsers.push({ ...profile, workspace_id: this.target(u) });
    }
  }

  async photosToCopy() {
    return this.byUserId(this.own(this.data.slackUsers).map((u) => this.full(u)))
      .map((u) => ({ u, from: this.own(this.data.slackUsers).find((x) => x.user_id === u.user_id)?.copied_from_url ?? null }))
      .filter(({ u, from }) => u.image_url !== null && u.image_url !== from)
      .map(({ u }) => ({ user_id: u.user_id, image_url: u.image_url as string, image_path: u.image_path }));
  }

  async markPhotoCopied(userId: string, copy: { from: string; path: string }) {
    const row = this.own(this.data.slackUsers).find((u) => u.user_id === userId && u.image_url === copy.from);
    if (row) Object.assign(row, { image_path: copy.path, copied_from_url: copy.from });
  }

  async photoCopiesToRemove() {
    return this.byUserId(this.own(this.data.slackUsers).map((u) => this.full(u)))
      .filter((u) => u.image_path !== null && u.image_url === null)
      .map((u) => ({ user_id: u.user_id, image_path: u.image_path as string }));
  }

  async clearPhotoCopy(userId: string, path: string) {
    const row = this.own(this.data.slackUsers).find((u) => u.user_id === userId && u.image_path === path);
    if (row) Object.assign(row, { image_path: null, copied_from_url: null });
  }
}
