import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import type { NavMode } from "@/lib/nav-mode";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** A signed-in user's profile row (one per Supabase Auth user): their role and time zone settings. Not a member record. */
export type UserProfile = Row<"user_profiles">;

/** A profile as the in-memory dataset keeps it: the id and email, and whatever else a test names. */
export type UserProfileSeed = Pick<UserProfile, "id" | "email"> & Partial<Omit<UserProfile, "id" | "email">>;

/** What the activity log's staff filter needs. */
export type StaffProfile = Pick<UserProfile, "id" | "email" | "role">;

const ID_CHUNK = 100;

/**
 * The profile of each Supabase Auth user (`user_profiles`, keyed by the auth user id): the role
 * (`admin`, `assistant`, `member`), and the time zone settings. Every method throws on a database
 * error, except {@link isAdmin}, which authorizes and so answers "no" when it can't tell.
 */
export interface ProfileRepository {
  /** One user's profile, or null when they have none. */
  byId(userId: string): Promise<UserProfile | null>;
  /**
   * Whether this user is an admin, read from the profile (never from the token's role claim, which
   * can be up to an hour stale). A missing profile or a failed lookup is "no", never an error:
   * callers use this to decide access, and unknown must not mean admin.
   */
  isAdmin(userId: string): Promise<boolean>;
  /** The admins and assistants, by email. */
  staff(): Promise<StaffProfile[]>;
  /** The auth user ids of every admin. */
  adminIds(): Promise<string[]>;
  /** These users' profiles (users without one are left out). Chunked. */
  byIds(userIds: string[]): Promise<UserProfile[]>;
  /** Every profile, by id. Paginated. */
  all(): Promise<UserProfile[]>;
  /** Sets a user's role. */
  setRole(userId: string, role: string): Promise<void>;
  /** Saves the user's time zone preference ("browser" until one is detected). */
  setTimezonePreference(userId: string, timezone: string): Promise<void>;
  /** Saves how the user's sidebar behaves (pinned open, pinned closed, auto-hide). */
  setNavMode(userId: string, mode: NavMode): Promise<void>;
  /** Saves (or, with null, turns off) the user's secondary time zone. */
  setSecondaryTimezone(userId: string, timezone: string | null): Promise<void>;
  /** Whether the user chose "leave me out of statistics" on /privacy (lib/analytics/opt-out.ts). */
  analyticsOptedOut(userId: string): Promise<boolean>;
  /** Records that the user left usage statistics at this moment, or, with null, that they are back in. */
  setAnalyticsOptOut(userId: string, at: string | null): Promise<void>;
}

export class SupabaseProfileRepository implements ProfileRepository {
  constructor(private readonly db: Db) {}

  async byId(userId: string) {
    const { data, error } = await this.db.from("user_profiles").select("*").eq("id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async isAdmin(userId: string) {
    const { data, error } = await this.db.from("user_profiles").select("role").eq("id", userId).maybeSingle();
    return !error && data?.role === "admin";
  }

  async staff() {
    const { data, error } = await this.db.from("user_profiles").select("id, email, role").in("role", ["admin", "assistant"]).order("email").order("id");
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async adminIds() {
    return fetchAllRows<{ id: string }>(
      (from, to) =>
        this.db.from("user_profiles").select("id").eq("role", "admin").order("id").range(from, to) as unknown as PromiseLike<{
          data: { id: string }[] | null;
          error: { message: string } | null;
        }>
    ).then((rows) => rows.map((r) => r.id));
  }

  async byIds(userIds: string[]) {
    const rows: UserProfile[] = [];
    for (const part of chunk([...new Set(userIds)], ID_CHUNK)) {
      const { data, error } = await this.db.from("user_profiles").select("*").in("id", part);
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
    }
    return rows;
  }

  async all() {
    return fetchAllRows<UserProfile>(
      (from, to) =>
        this.db.from("user_profiles").select("*").order("id").range(from, to) as unknown as PromiseLike<{
          data: UserProfile[] | null;
          error: { message: string } | null;
        }>
    );
  }

  async setRole(userId: string, role: string) {
    const { error } = await this.db.from("user_profiles").update({ role }).eq("id", userId);
    if (error) throw new Error(error.message);
  }

  async setTimezonePreference(userId: string, timezone: string) {
    const { error } = await this.db.from("user_profiles").update({ timezone_preference: timezone }).eq("id", userId);
    if (error) throw new Error(error.message);
  }

  async setNavMode(userId: string, mode: NavMode) {
    const { error } = await this.db.from("user_profiles").update({ nav_mode: mode }).eq("id", userId);
    if (error) throw new Error(error.message);
  }

  async setSecondaryTimezone(userId: string, timezone: string | null) {
    const { error } = await this.db.from("user_profiles").update({ secondary_timezone: timezone }).eq("id", userId);
    if (error) throw new Error(error.message);
  }

  async analyticsOptedOut(userId: string) {
    const { data, error } = await this.db.from("user_profiles").select("analytics_opt_out_at").eq("id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.analytics_opt_out_at != null;
  }

  async setAnalyticsOptOut(userId: string, at: string | null) {
    const { error } = await this.db.from("user_profiles").update({ analytics_opt_out_at: at }).eq("id", userId);
    if (error) throw new Error(error.message);
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryProfileRepository implements ProfileRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private full(p: UserProfileSeed): UserProfile {
    return { role: "member", created_at: null, updated_at: null, timezone_preference: null, nav_mode: null, secondary_timezone: null, analytics_opt_out_at: null, ...p };
  }

  async byId(userId: string) {
    const p = this.data.userProfiles.find((x) => x.id === userId);
    return p ? this.full(p) : null;
  }

  async isAdmin(userId: string) {
    return (await this.byId(userId))?.role === "admin";
  }

  async staff() {
    return this.data.userProfiles
      .map((p) => this.full(p))
      .filter((p) => p.role === "admin" || p.role === "assistant")
      .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : a.id < b.id ? -1 : 1))
      .map(({ id, email, role }) => ({ id, email, role }));
  }

  async adminIds() {
    return this.data.userProfiles.filter((p) => (p.role ?? "member") === "admin").map((p) => p.id);
  }

  async byIds(userIds: string[]) {
    const wanted = new Set(userIds);
    return this.data.userProfiles.filter((p) => wanted.has(p.id)).map((p) => this.full(p));
  }

  async all() {
    return this.data.userProfiles.map((p) => this.full(p)).sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  async setRole(userId: string, role: string) {
    for (const p of this.data.userProfiles) if (p.id === userId) p.role = role;
  }

  async setTimezonePreference(userId: string, timezone: string) {
    for (const p of this.data.userProfiles) if (p.id === userId) p.timezone_preference = timezone;
  }

  async setNavMode(userId: string, mode: NavMode) {
    for (const p of this.data.userProfiles) if (p.id === userId) p.nav_mode = mode;
  }

  async setSecondaryTimezone(userId: string, timezone: string | null) {
    for (const p of this.data.userProfiles) if (p.id === userId) p.secondary_timezone = timezone;
  }

  async analyticsOptedOut(userId: string) {
    return (await this.byId(userId))?.analytics_opt_out_at != null;
  }

  async setAnalyticsOptOut(userId: string, at: string | null) {
    for (const p of this.data.userProfiles) if (p.id === userId) p.analytics_opt_out_at = at;
  }
}
