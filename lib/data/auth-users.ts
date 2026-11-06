import { randomUUID } from "node:crypto";
import { clock } from "@/lib/clock";
import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** An account in Supabase Auth (GoTrue), as Hub code needs it: no tokens, identities or provider data. */
export interface AuthUser {
  id: string;
  /** Lowercase; null for an account without one. */
  email: string | null;
  /** The address is confirmed: they accepted their invite or signed in once. False while the invite is pending. */
  confirmed: boolean;
  createdAt: string;
  /** When a ban ends, or null. A date in the past means the ban is over, so compare it with now. */
  bannedUntil: string | null;
  lastSignInAt: string | null;
  appMetadata: Record<string, unknown>;
}

/** How long a ban lasts, in hours (`"8760h"`), or `"none"` to lift it. */
export type BanDuration = "none" | `${number}h`;

/** What `generateMagicLink` hands back: nothing is emailed, the caller decides what to do with it. */
export interface MagicLink {
  /** Signs the user in through `verifyOtp({ type: "email", token_hash })`. */
  hashedToken: string;
  /** The one-time code typed on the sign-in page. */
  code: string;
}

/**
 * Supabase Auth's accounts (`auth.users`), which are not a table the Data API can query, so they have
 * their own repository: the admin API behind it is paged and its calls are scattered otherwise.
 * Service role only: build it from `getServiceRepos()` or a service-role client. Throws on an error;
 * a lookup that finds nothing returns null.
 */
export interface AuthUserRepository {
  /** Every account, paged past the admin API's limit of 1000 per page. */
  all(): Promise<AuthUser[]>;
  /** One account, or null when there is none. */
  byId(id: string): Promise<AuthUser | null>;
  /** Creates a confirmed account without sending anything, optionally banned until `banDuration` is lifted. Throws if the address is taken. */
  create(input: { email: string; banDuration?: Exclude<BanDuration, "none"> }): Promise<AuthUser>;
  /** Sends the invite email, creating the account unconfirmed if it is new. Throws for an address that already accepted. */
  invite(email: string): Promise<AuthUser>;
  /** Bans the account for `duration`, or lifts its ban with `"none"`. */
  setBan(id: string, duration: BanDuration): Promise<void>;
  /** Adds these keys to the account's `app_metadata`, keeping the others; a key set to null is removed. */
  mergeAppMetadata(id: string, metadata: Record<string, unknown>): Promise<void>;
  /**
   * Changes the address they sign in with, already confirmed (no email goes out): the caller has verified it.
   * Throws when another account has the address, or there is no such account.
   */
  setEmail(id: string, email: string): Promise<void>;
  /**
   * A fresh one-time sign-in for this account, without emailing it. Throws when there is no such account.
   * By id on purpose: the admin API's generateLink *creates* an account for an address it does not know.
   */
  generateMagicLink(id: string): Promise<MagicLink>;
  /** Deletes the account. */
  delete(id: string): Promise<void>;
}

/** Accounts per page; the admin API caps a page at this. */
const PER_PAGE = 1000;

type GoTrueUser = {
  id: string;
  email?: string;
  email_confirmed_at?: string;
  created_at: string;
  banned_until?: string | null;
  last_sign_in_at?: string;
  app_metadata?: Record<string, unknown>;
};

function toAuthUser(u: GoTrueUser): AuthUser {
  const banned = u.banned_until && !Number.isNaN(new Date(u.banned_until).getTime()) ? u.banned_until : null;
  return {
    id: u.id,
    email: u.email ? u.email.toLowerCase() : null,
    confirmed: !!u.email_confirmed_at,
    createdAt: u.created_at,
    bannedUntil: banned,
    lastSignInAt: u.last_sign_in_at ?? null,
    appMetadata: u.app_metadata ?? {},
  };
}

export class SupabaseAuthUserRepository implements AuthUserRepository {
  constructor(private readonly db: Db) {}

  private get admin() {
    return this.db.auth.admin;
  }

  async all(): Promise<AuthUser[]> {
    const all: AuthUser[] = [];
    for (let page = 1; ; page++) {
      const { data, error } = await this.admin.listUsers({ page, perPage: PER_PAGE });
      if (error) throw new Error(error.message);
      all.push(...data.users.map(toAuthUser));
      if (data.users.length < PER_PAGE) return all;
    }
  }

  async byId(id: string): Promise<AuthUser | null> {
    const { data, error } = await this.admin.getUserById(id);
    if (error) {
      if (error.status === 404 || error.code === "user_not_found") return null;
      throw new Error(error.message);
    }
    return data.user ? toAuthUser(data.user) : null;
  }

  async create(input: { email: string; banDuration?: Exclude<BanDuration, "none"> }): Promise<AuthUser> {
    const { data, error } = await this.admin.createUser({
      email: input.email,
      email_confirm: true,
      ...(input.banDuration ? { ban_duration: input.banDuration } : {}),
    });
    if (error || !data.user) throw new Error(error?.message ?? "No user was created");
    return toAuthUser(data.user);
  }

  async invite(email: string): Promise<AuthUser> {
    const { data, error } = await this.admin.inviteUserByEmail(email);
    if (error || !data.user) throw new Error(error?.message ?? "No invite was sent");
    return toAuthUser(data.user);
  }

  async setBan(id: string, duration: BanDuration): Promise<void> {
    const { error } = await this.admin.updateUserById(id, { ban_duration: duration });
    if (error) throw new Error(error.message);
  }

  async mergeAppMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    const { error } = await this.admin.updateUserById(id, { app_metadata: metadata });
    if (error) throw new Error(error.message);
  }

  async setEmail(id: string, email: string): Promise<void> {
    const { error } = await this.admin.updateUserById(id, { email: email.toLowerCase(), email_confirm: true });
    if (error) throw new Error(error.message);
  }

  async generateMagicLink(id: string): Promise<MagicLink> {
    const user = await this.byId(id);
    if (!user?.email) throw new Error("User not found");
    const { data, error } = await this.admin.generateLink({ type: "magiclink", email: user.email });
    const hashedToken = data?.properties?.hashed_token;
    const code = data?.properties?.email_otp;
    if (error || !hashedToken || !code) throw new Error(error?.message ?? "No sign-in link was generated");
    return { hashedToken, code };
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.admin.deleteUser(id);
    if (error) throw new Error(error.message);
  }
}

const HOUR_MS = 3_600_000;

function banEnd(duration: BanDuration): string | null {
  if (duration === "none") return null;
  const hours = /^(\d+)h$/.exec(duration);
  if (!hours) throw new Error(`Unsupported ban duration: ${duration}`);
  return new Date(clock.now() + Number(hours[1]) * HOUR_MS).toISOString();
}

/** In-memory twin over an `InMemoryDataset`'s `authUsers`. */
export class InMemoryAuthUserRepository implements AuthUserRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private find(id: string) {
    const user = this.data.authUsers.find((u) => u.id === id);
    if (!user) throw new Error("User not found");
    return user;
  }

  private findByEmail(email: string) {
    return this.data.authUsers.find((u) => u.email === email.toLowerCase());
  }

  async all(): Promise<AuthUser[]> {
    return this.data.authUsers.map((u) => ({ ...u, appMetadata: { ...u.appMetadata } }));
  }

  async byId(id: string): Promise<AuthUser | null> {
    const user = this.data.authUsers.find((u) => u.id === id);
    return user ? { ...user, appMetadata: { ...user.appMetadata } } : null;
  }

  async create(input: { email: string; banDuration?: Exclude<BanDuration, "none"> }): Promise<AuthUser> {
    if (this.findByEmail(input.email)) throw new Error("A user with this email address has already been registered");
    const user: AuthUser = {
      id: randomUUID(),
      email: input.email.toLowerCase(),
      confirmed: true,
      createdAt: new Date(clock.now()).toISOString(),
      bannedUntil: input.banDuration ? banEnd(input.banDuration) : null,
      lastSignInAt: null,
      appMetadata: {},
    };
    this.data.authUsers.push(user);
    return { ...user };
  }

  async invite(email: string): Promise<AuthUser> {
    const existing = this.findByEmail(email);
    if (existing?.confirmed) throw new Error("A user with this email address has already been registered");
    if (existing) return { ...existing };
    const user: AuthUser = {
      id: randomUUID(),
      email: email.toLowerCase(),
      confirmed: false,
      createdAt: new Date(clock.now()).toISOString(),
      bannedUntil: null,
      lastSignInAt: null,
      appMetadata: {},
    };
    this.data.authUsers.push(user);
    return { ...user };
  }

  async setBan(id: string, duration: BanDuration): Promise<void> {
    this.find(id).bannedUntil = banEnd(duration);
  }

  async mergeAppMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    const user = this.find(id);
    const merged = { ...user.appMetadata, ...metadata };
    for (const key of Object.keys(merged)) if (merged[key] === null) delete merged[key];
    user.appMetadata = merged;
  }

  async setEmail(id: string, email: string): Promise<void> {
    const user = this.find(id);
    const taken = this.findByEmail(email);
    if (taken && taken.id !== id) throw new Error("A user with this email address has already been registered");
    user.email = email.toLowerCase();
  }

  async generateMagicLink(id: string): Promise<MagicLink> {
    if (!this.find(id).email) throw new Error("User not found");
    return { hashedToken: randomUUID().replace(/-/g, ""), code: String(Math.floor(10_000_000 + Math.random() * 90_000_000)) };
  }

  async delete(id: string): Promise<void> {
    this.find(id);
    this.data.authUsers = this.data.authUsers.filter((u) => u.id !== id);
  }
}
