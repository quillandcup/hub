import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import { primaryRole, staffRolesIn, type StaffRole } from "@/lib/permissions";
import type { NavMode } from "@/lib/nav-mode";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { escapeLike } from "./query";

/** A signed-in user's profile row (one per Supabase Auth user): their role and time zone settings. Not a member record. */
export type UserProfile = Row<"user_profiles">;

/** A profile as the in-memory dataset keeps it: the id and email, and whatever else a test names. */
export type UserProfileSeed = Pick<UserProfile, "id" | "email"> & Partial<Omit<UserProfile, "id" | "email">>;

/**
 * What the activity log's staff filter needs: the id, the email, the primary role (what `user_profiles.role` holds) and
 * every staff role the person holds (a person can hold several; what they may do is the union).
 */
export type StaffProfile = Pick<UserProfile, "id" | "email" | "role"> & { roles: StaffRole[] };

/** The profile fields a role lookup needs. */
export type ProfileRoleRow = Pick<UserProfile, "id" | "email" | "role">;

const ID_CHUNK = 100;

/** `setRoles` was refused by the rules on who may change which role (`roleChangeRefusal` in src/lib/permissions.ts); the message says why. */
export class RoleChangeRefused extends Error {}

/** Groups (user id, role) pairs into each user's staff roles, highest priority first; non-staff roles are dropped. */
function rolesByUser(pairs: Iterable<readonly [string, string]>): Map<string, StaffRole[]> {
  const raw = new Map<string, string[]>();
  for (const [userId, role] of pairs) raw.set(userId, [...(raw.get(userId) ?? []), role]);
  const out = new Map<string, StaffRole[]>();
  for (const [userId, list] of raw) {
    const roles = staffRolesIn(list);
    if (roles.length > 0) out.set(userId, roles);
  }
  return out;
}

/** The profiles as staff entries, by email then id, each with the roles it holds. */
function withRoles(profiles: readonly ProfileRoleRow[], held: ReadonlyMap<string, StaffRole[]>): StaffProfile[] {
  return [...profiles]
    .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : a.id < b.id ? -1 : 1))
    .map(({ id, email, role }) => ({ id, email, role, roles: held.get(id) ?? [] }));
}

/**
 * The profile of each Supabase Auth user (`user_profiles`, keyed by the auth user id): the roles, and the time zone
 * settings. A user holds a set of staff roles (`user_roles`; a member holds none) and `user_profiles.role` keeps the
 * highest-priority one until the contract step drops it, so every read of "who holds this role" counts both places.
 * Every method throws on a database error, except {@link isAdmin}, which authorizes and so answers "no" when it can't tell.
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
  /** The admins and assistants (holding either, among any roles), by email. */
  staff(): Promise<StaffProfile[]>;
  /** The profiles of everyone holding any of these roles, by email then id. Empty roles: nobody. */
  byRoles(roles: string[]): Promise<StaffProfile[]>;
  /** The auth user ids of everyone holding admin. */
  adminIds(): Promise<string[]>;
  /** The staff roles this user holds, highest priority first (none for a member, or someone without a profile). */
  rolesOf(userId: string): Promise<StaffRole[]>;
  /** The staff roles of every user who holds any (users holding none are left out). Paginated. */
  allRoles(): Promise<Map<string, StaffRole[]>>;
  /** Replaces the user's staff roles (an empty list makes them a member), keeping `user_profiles.role` at the primary one. */
  setRoles(userId: string, roles: readonly string[]): Promise<void>;
  /** These users' profiles (users without one are left out). Chunked. */
  byIds(userIds: string[]): Promise<UserProfile[]>;
  /** Every profile, by id. Paginated. */
  all(): Promise<UserProfile[]>;
  /** Sets one role as the user's only role (`member` for none): `setRoles` with one entry. */
  setRole(userId: string, role: string): Promise<void>;
  /** The one profile whose sign-in email is this address (any case), or null when none or several match. */
  uniqueByEmail(email: string): Promise<ProfileRoleRow | null>;
  /** Saves the user's time zone preference ("browser" until one is detected). */
  setTimezonePreference(userId: string, timezone: string): Promise<void>;
  /** Saves how the user's sidebar behaves (pinned open, pinned closed, auto-hide). */
  setNavMode(userId: string, mode: NavMode): Promise<void>;
  /** Saves (or, with null, turns off) the user's secondary time zone. */
  setSecondaryTimezone(userId: string, timezone: string | null): Promise<void>;
  /** Whether the user chose "leave me out of statistics" on /privacy (src/lib/analytics/opt-out.ts). */
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

  async uniqueByEmail(email: string) {
    const { data, error } = await this.db.from("user_profiles").select("id, email, role").ilike("email", escapeLike(email)).limit(2);
    if (error) throw new Error(error.message);
    return data?.length === 1 ? data[0] : null;
  }

  async isAdmin(userId: string) {
    // Holding admin in either place counts; a failed lookup is "no".
    const [fromRoles, fromColumn] = await Promise.all([
      this.db.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
      this.db.from("user_profiles").select("role").eq("id", userId).maybeSingle(),
    ]);
    return (!fromRoles.error && fromRoles.data?.role === "admin") || (!fromColumn.error && fromColumn.data?.role === "admin");
  }

  async rolesOf(userId: string) {
    const [fromRoles, fromColumn] = await Promise.all([
      this.db.from("user_roles").select("role").eq("user_id", userId),
      this.db.from("user_profiles").select("role").eq("id", userId).maybeSingle(),
    ]);
    if (fromRoles.error) throw new Error(fromRoles.error.message);
    if (fromColumn.error) throw new Error(fromColumn.error.message);
    return staffRolesIn([...(fromRoles.data ?? []).map((r) => r.role), fromColumn.data?.role ?? null]);
  }

  async allRoles() {
    const [rows, profiles] = await Promise.all([
      fetchAllRows<{ user_id: string; role: string }>((from, to) => this.db.from("user_roles").select("user_id, role").order("id").range(from, to)),
      fetchAllRows<{ id: string; role: string }>((from, to) => this.db.from("user_profiles").select("id, role").neq("role", "member").order("id").range(from, to)),
    ]);
    return rolesByUser([...rows.map((r) => [r.user_id, r.role] as const), ...profiles.map((p) => [p.id, p.role] as const)]);
  }

  /** The ids of everyone who holds any of these roles, in `user_roles` or in the old column. */
  private async idsHolding(roles: readonly string[]): Promise<string[]> {
    const [fromRoles, fromColumn] = await Promise.all([
      fetchAllRows<{ user_id: string }>((from, to) => this.db.from("user_roles").select("user_id").in("role", [...roles]).order("id").range(from, to)),
      fetchAllRows<{ id: string }>((from, to) => this.db.from("user_profiles").select("id").in("role", [...roles]).order("id").range(from, to)),
    ]);
    return [...new Set([...fromRoles.map((r) => r.user_id), ...fromColumn.map((r) => r.id)])];
  }

  /** The people holding any of these roles, by email then id, each with every staff role they hold. */
  private async holding(roles: readonly string[]): Promise<StaffProfile[]> {
    if (roles.length === 0) return [];
    const profiles = await this.byIds(await this.idsHolding(roles));
    const held = await this.allRoles();
    return withRoles(profiles, held);
  }

  async staff() {
    return this.holding(["admin", "assistant"]);
  }

  async byRoles(roles: string[]) {
    return this.holding(roles);
  }

  async adminIds() {
    return this.idsHolding(["admin"]);
  }

  async setRoles(userId: string, roles: readonly string[]) {
    const { error } = await this.db.rpc("set_user_roles", { p_user: userId, p_roles: [...roles] });
    // 42501 is the database refusing on purpose (who may change which role): say so, so a route can answer 403.
    if (error) throw error.code === "42501" ? new RoleChangeRefused(error.message) : new Error(error.message);
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
        this.db.from("user_profiles").select("*").order("id").range(from, to)
    );
  }

  async setRole(userId: string, role: string) {
    await this.setRoles(userId, [role]);
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

  async uniqueByEmail(email: string) {
    const matches = this.data.userProfiles.filter((p) => p.email.toLowerCase() === email.toLowerCase());
    return matches.length === 1 ? { id: matches[0].id, email: matches[0].email, role: this.full(matches[0]).role } : null;
  }

  /** What each user holds: their `user_roles` rows and the old column, the way the database reads them. */
  private held() {
    return rolesByUser([
      ...this.data.userRoles.map((r) => [r.user_id, r.role] as const),
      ...this.data.userProfiles.map((p) => [p.id, p.role ?? "member"] as const),
    ]);
  }

  async isAdmin(userId: string) {
    return (await this.rolesOf(userId)).includes("admin");
  }

  async rolesOf(userId: string) {
    return this.held().get(userId) ?? [];
  }

  async allRoles() {
    return this.held();
  }

  private holding(roles: readonly string[]): StaffProfile[] {
    const held = this.held();
    return withRoles(
      this.data.userProfiles.map((p) => this.full(p)).filter((p) => (held.get(p.id) ?? []).some((r) => roles.includes(r))),
      held,
    );
  }

  async staff() {
    return this.holding(["admin", "assistant"]);
  }

  async byRoles(roles: string[]) {
    return this.holding(roles);
  }

  async adminIds() {
    return this.holding(["admin"]).map((p) => p.id);
  }

  async setRoles(userId: string, roles: readonly string[]) {
    const wanted = staffRolesIn(roles);
    // The database refuses a name that is neither a staff role nor `member`; so does the twin.
    if (roles.some((r) => r !== "member" && !wanted.includes(r as StaffRole))) throw new Error("Unknown role");
    const profile = this.data.userProfiles.find((p) => p.id === userId);
    if (!profile) throw new Error("No such user");
    this.data.userRoles = this.data.userRoles.filter((r) => r.user_id !== userId);
    for (const role of wanted) this.data.userRoles.push({ user_id: userId, role });
    profile.role = primaryRole(wanted) ?? "member";
  }

  async byIds(userIds: string[]) {
    const wanted = new Set(userIds);
    return this.data.userProfiles.filter((p) => wanted.has(p.id)).map((p) => this.full(p));
  }

  async all() {
    return this.data.userProfiles.map((p) => this.full(p)).sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  async setRole(userId: string, role: string) {
    await this.setRoles(userId, [role]);
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
