import { fetchAllRows } from "@/lib/supabase/paginate";
import { byKeyThenId } from "./query";
import type { Db, Insert, Row, Update } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** A stretch of hiatus (`member_hiatus_history`). An open end date means it has not ended. */
export type HiatusRow = Row<"member_hiatus_history">;
export type NewHiatus = Insert<"member_hiatus_history">;
export type HiatusPatch = Update<"member_hiatus_history">;
/** What a membership timeline needs of a hiatus. */
export type HiatusWindow = Pick<HiatusRow, "id" | "start_date" | "end_date" | "reason" | "notes">;
/** A hiatus with its member, for scans over every member. */
export type HiatusOfMember = Pick<HiatusRow, "id" | "member_id" | "start_date" | "end_date">;

/** An admin's grant of membership (gift, special, direct Stripe) that no Kajabi stint backs (`member_status_overrides`). */
export type StatusOverrideRow = Row<"member_status_overrides">;
export type NewStatusOverride = Insert<"member_status_overrides">;
export type StatusOverridePatch = Update<"member_status_overrides">;
/** What a membership timeline needs of an override. */
export type StatusOverrideWindow = Pick<StatusOverrideRow, "id" | "override_type" | "reason" | "starts_at" | "expires_at">;
/** An override with the member it is for (null when the member no longer exists). */
export type StatusOverrideWithMember = StatusOverrideRow & {
  member: { id: string; name: string; display_name: string | null; email: string } | null;
};

/** A legacy correction of when a member first joined (`member_join_date_overrides`). */
export type JoinDateOverrideRow = Row<"member_join_date_overrides">;
export type JoinDateOverride = Pick<JoinDateOverrideRow, "member_id" | "first_joined_at">;

/**
 * Profile fields a member edits in the Hub (`member_profile_overrides`), each with three states:
 * null (never set, follow Kajabi), "" (cleared) or a value.
 */
export type ProfileOverrideFields = Pick<Row<"member_profile_overrides">, "bio" | "instagram_url" | "facebook_url" | "twitter_url">;
export type ProfileOverrideStoredRow = Row<"member_profile_overrides">;
export type ProfileOverrideRow = ProfileOverrideFields & Pick<ProfileOverrideStoredRow, "member_id">;

const HIATUS_WINDOW_COLUMNS = "id, start_date, end_date, reason, notes";
const OVERRIDE_WINDOW_COLUMNS = "id, override_type, reason, starts_at, expires_at";
const OVERRIDE_WITH_MEMBER = "*, member:members(id, name, display_name, email)";
const PROFILE_COLUMNS = "member_id, bio, instagram_url, facebook_url, twitter_url";


/** Ordered by a text key, then by id (see `byKeyThenId`). */
const byKey = <T extends { id: string }>(key: (row: T) => string, descending = false) => byKeyThenId(key, (row: T) => row.id, descending);

/** PostgREST returns a to-one embed as an object, though callers have also met it as a one-item array. */
function one<T>(embed: T | T[] | null | undefined): T | null {
  return (Array.isArray(embed) ? embed[0] : embed) ?? null;
}

/**
 * What the Hub stores by hand about a member's status and profile: hiatus windows, status overrides
 * (gift, special, direct Stripe), legacy join-date corrections and the profile fields the member
 * edits (`member_hiatus_history`, `member_status_overrides`, `member_join_date_overrides`,
 * `member_profile_overrides`). Local data: these tables are the source of truth, not reprocessed;
 * the members processing reads them to derive `members.status` and the tenure fields. Every method
 * throws on a database error; scans are paginated.
 */
export interface MemberStatusRepository {
  // --- hiatus ---
  /** A member's hiatus windows, latest start first. */
  hiatusesOf(memberId: string): Promise<HiatusWindow[]>;
  /** One hiatus, or null when there is none. */
  hiatusById(id: string): Promise<HiatusRow | null>;
  /** Every member's hiatus windows, ordered by id. Paginated. */
  allHiatuses(): Promise<HiatusOfMember[]>;
  /** The members on hiatus on this day (YYYY-MM-DD): it began by then and has no end or ends on or after it. Paginated. */
  memberIdsOnHiatus(day: string): Promise<Set<string>>;
  createHiatus(hiatus: NewHiatus): Promise<HiatusRow>;
  /** Changes a hiatus and returns it. Throws when there is no such hiatus. */
  updateHiatus(id: string, patch: HiatusPatch): Promise<HiatusRow>;
  deleteHiatus(id: string): Promise<void>;

  // --- status overrides ---
  /** A member's status overrides, latest start first. */
  statusOverridesOf(memberId: string): Promise<StatusOverrideWindow[]>;
  /** Every status override as stored, oldest first. Paginated. */
  allStatusOverrides(): Promise<StatusOverrideRow[]>;
  /** Every status override with its member, newest first. Paginated. */
  statusOverridesWithMember(): Promise<StatusOverrideWithMember[]>;
  /** Creates an override and returns it with its member. */
  createStatusOverride(override: NewStatusOverride): Promise<StatusOverrideWithMember>;
  /** Changes an override and returns it with its member. Throws when there is no such override. */
  updateStatusOverride(id: string, patch: StatusOverridePatch): Promise<StatusOverrideWithMember>;
  deleteStatusOverride(id: string): Promise<void>;

  // --- both ---
  /** Moves every hiatus and status override of one member to another (a member merge). */
  reassignMember(fromMemberId: string, toMemberId: string): Promise<void>;

  // --- join dates ---
  /** Every legacy join-date correction, ordered by member. Paginated. */
  joinDateOverrides(): Promise<JoinDateOverride[]>;

  // --- profile overrides ---
  /** What a member has set in the Hub, or null when they never saved anything. */
  profileOverrideOf(memberId: string): Promise<ProfileOverrideFields | null>;
  /** Every member's profile overrides, ordered by member. Paginated. */
  profileOverrides(): Promise<ProfileOverrideRow[]>;
  /** Saves the given fields (and who saved them), keeping the ones not given. Creates the member's row when there is none. */
  saveProfileOverride(memberId: string, fields: Partial<ProfileOverrideFields>, updatedBy: string): Promise<void>;
}

export class SupabaseMemberStatusRepository implements MemberStatusRepository {
  constructor(private readonly db: Db) {}

  async hiatusesOf(memberId: string) {
    const { data, error } = await this.db
      .from("member_hiatus_history")
      .select(HIATUS_WINDOW_COLUMNS)
      .eq("member_id", memberId)
      .order("start_date", { ascending: false })
      .order("id");
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async hiatusById(id: string) {
    const { data, error } = await this.db.from("member_hiatus_history").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async allHiatuses() {
    return fetchAllRows<HiatusOfMember>(
      (from, to) => this.db.from("member_hiatus_history").select("id, member_id, start_date, end_date").order("id").range(from, to),
    );
  }

  async memberIdsOnHiatus(day: string) {
    const rows = await fetchAllRows<Pick<HiatusRow, "member_id">>(
      (from, to) =>
        this.db
          .from("member_hiatus_history")
          .select("member_id")
          .lte("start_date", day)
          .or(`end_date.is.null,end_date.gte.${day}`)
          .order("id")
          .range(from, to),
    );
    return new Set(rows.map((r) => r.member_id));
  }

  async createHiatus(hiatus: NewHiatus) {
    const { data, error } = await this.db.from("member_hiatus_history").insert(hiatus).select("*").single();
    if (error) throw new Error(error.message);
    return data;
  }

  async updateHiatus(id: string, patch: HiatusPatch) {
    const { data, error } = await this.db.from("member_hiatus_history").update(patch).eq("id", id).select("*").single();
    if (error) throw new Error(error.message);
    return data;
  }

  async deleteHiatus(id: string) {
    const { error } = await this.db.from("member_hiatus_history").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async statusOverridesOf(memberId: string) {
    const { data, error } = await this.db
      .from("member_status_overrides")
      .select(OVERRIDE_WINDOW_COLUMNS)
      .eq("member_id", memberId)
      .order("starts_at", { ascending: false })
      .order("id");
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async allStatusOverrides() {
    return fetchAllRows<StatusOverrideRow>(
      (from, to) => this.db.from("member_status_overrides").select("*").order("created_at").order("id").range(from, to),
    );
  }

  async statusOverridesWithMember() {
    const rows = await fetchAllRows<StatusOverrideWithMemberRow>(
      (from, to) =>
        this.db.from("member_status_overrides").select(OVERRIDE_WITH_MEMBER).order("created_at", { ascending: false }).order("id").range(from, to),
    );
    return rows.map(withOneMember);
  }

  async createStatusOverride(override: NewStatusOverride) {
    const { data, error } = await this.db.from("member_status_overrides").insert(override).select(OVERRIDE_WITH_MEMBER).single();
    if (error) throw new Error(error.message);
    return withOneMember(data);
  }

  async updateStatusOverride(id: string, patch: StatusOverridePatch) {
    const { data, error } = await this.db.from("member_status_overrides").update(patch).eq("id", id).select(OVERRIDE_WITH_MEMBER).single();
    if (error) throw new Error(error.message);
    return withOneMember(data);
  }

  async deleteStatusOverride(id: string) {
    const { error } = await this.db.from("member_status_overrides").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async reassignMember(fromMemberId: string, toMemberId: string) {
    const results = await Promise.all([
      this.db.from("member_hiatus_history").update({ member_id: toMemberId }).eq("member_id", fromMemberId),
      this.db.from("member_status_overrides").update({ member_id: toMemberId }).eq("member_id", fromMemberId),
    ]);
    const failed = results.find((r) => r.error);
    if (failed?.error) throw new Error(failed.error.message);
  }

  async joinDateOverrides() {
    return fetchAllRows<JoinDateOverride>(
      (from, to) => this.db.from("member_join_date_overrides").select("member_id, first_joined_at").order("member_id").range(from, to),
    );
  }

  async profileOverrideOf(memberId: string) {
    const { data, error } = await this.db
      .from("member_profile_overrides")
      .select("bio, instagram_url, facebook_url, twitter_url")
      .eq("member_id", memberId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async profileOverrides() {
    return fetchAllRows<ProfileOverrideRow>(
      (from, to) => this.db.from("member_profile_overrides").select(PROFILE_COLUMNS).order("member_id").range(from, to),
    );
  }

  async saveProfileOverride(memberId: string, fields: Partial<ProfileOverrideFields>, updatedBy: string) {
    const { error } = await this.db
      .from("member_profile_overrides")
      .upsert({ member_id: memberId, ...fields, updated_by: updatedBy }, { onConflict: "member_id" });
    if (error) throw new Error(error.message);
  }
}

type StatusOverrideWithMemberRow = StatusOverrideRow & {
  member: NonNullable<StatusOverrideWithMember["member"]> | NonNullable<StatusOverrideWithMember["member"]>[] | null;
};

function withOneMember(row: StatusOverrideWithMemberRow): StatusOverrideWithMember {
  return { ...row, member: one(row.member) };
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryMemberStatusRepository implements MemberStatusRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private now() {
    return new Date().toISOString();
  }

  private memberExists(id: string | null | undefined) {
    return id == null || this.data.members.some((m) => m.id === id);
  }

  private memberOf(id: string | null) {
    const m = id == null ? undefined : this.data.members.find((x) => x.id === id);
    return m ? { id: m.id, name: m.name, display_name: m.displayName ?? null, email: m.email ?? "" } : null;
  }

  private withMember(row: StatusOverrideRow): StatusOverrideWithMember {
    return { ...row, member: this.memberOf(row.member_id) };
  }

  async hiatusesOf(memberId: string) {
    return this.data.memberHiatuses
      .filter((h) => h.member_id === memberId)
      .sort(byKey((h) => h.start_date, true))
      .map(({ id, start_date, end_date, reason, notes }) => ({ id, start_date, end_date, reason, notes }));
  }

  async hiatusById(id: string) {
    const row = this.data.memberHiatuses.find((h) => h.id === id);
    return row ? { ...row } : null;
  }

  async allHiatuses() {
    return [...this.data.memberHiatuses].sort(byKey((h) => h.id)).map(({ id, member_id, start_date, end_date }) => ({ id, member_id, start_date, end_date }));
  }

  async memberIdsOnHiatus(day: string) {
    return new Set(this.data.memberHiatuses.filter((h) => h.start_date <= day && (h.end_date === null || h.end_date >= day)).map((h) => h.member_id));
  }

  async createHiatus(hiatus: NewHiatus) {
    if (!this.memberExists(hiatus.member_id)) throw new Error("violates foreign key constraint on member_id");
    const row: HiatusRow = { id: crypto.randomUUID(), created_at: this.now(), updated_at: this.now(), created_by: null, end_date: null, notes: null, reason: null, ...hiatus };
    this.data.memberHiatuses.push(row);
    return { ...row };
  }

  async updateHiatus(id: string, patch: HiatusPatch) {
    const row = this.data.memberHiatuses.find((h) => h.id === id);
    if (!row) throw new Error("JSON object requested, multiple (or no) rows returned");
    Object.assign(row, patch, { updated_at: this.now() });
    return { ...row };
  }

  async deleteHiatus(id: string) {
    this.data.memberHiatuses = this.data.memberHiatuses.filter((h) => h.id !== id);
  }

  async statusOverridesOf(memberId: string) {
    return this.data.memberStatusOverrides
      .filter((o) => o.member_id === memberId)
      .sort(byKey((o) => o.starts_at, true))
      .map(({ id, override_type, reason, starts_at, expires_at }) => ({ id, override_type, reason, starts_at, expires_at }));
  }

  async allStatusOverrides() {
    return [...this.data.memberStatusOverrides].sort(byKey((o) => o.created_at)).map((o) => ({ ...o }));
  }

  async statusOverridesWithMember() {
    return [...this.data.memberStatusOverrides].sort(byKey((o) => o.created_at, true)).map((o) => this.withMember(o));
  }

  async createStatusOverride(override: NewStatusOverride) {
    if (!this.memberExists(override.member_id)) throw new Error("violates foreign key constraint on member_id");
    const row: StatusOverrideRow = {
      id: crypto.randomUUID(),
      created_at: this.now(),
      updated_at: this.now(),
      created_by: null,
      expires_at: null,
      member_id: null,
      notes: null,
      starts_at: this.now(),
      ...(stripUndefined(override) as NewStatusOverride),
    };
    this.data.memberStatusOverrides.push(row);
    return this.withMember(row);
  }

  async updateStatusOverride(id: string, patch: StatusOverridePatch) {
    const row = this.data.memberStatusOverrides.find((o) => o.id === id);
    if (!row) throw new Error("JSON object requested, multiple (or no) rows returned");
    Object.assign(row, stripUndefined(patch), { updated_at: this.now() });
    return this.withMember(row);
  }

  async deleteStatusOverride(id: string) {
    this.data.memberStatusOverrides = this.data.memberStatusOverrides.filter((o) => o.id !== id);
  }

  async reassignMember(fromMemberId: string, toMemberId: string) {
    for (const h of this.data.memberHiatuses) if (h.member_id === fromMemberId) h.member_id = toMemberId;
    for (const o of this.data.memberStatusOverrides) if (o.member_id === fromMemberId) o.member_id = toMemberId;
  }

  async joinDateOverrides() {
    return [...this.data.memberJoinDateOverrides].sort((a, b) => (a.member_id < b.member_id ? -1 : a.member_id > b.member_id ? 1 : 0)).map(({ member_id, first_joined_at }) => ({ member_id, first_joined_at }));
  }

  async profileOverrideOf(memberId: string) {
    const row = this.data.memberProfileOverrides.find((p) => p.member_id === memberId);
    return row ? { bio: row.bio, instagram_url: row.instagram_url, facebook_url: row.facebook_url, twitter_url: row.twitter_url } : null;
  }

  async profileOverrides() {
    return [...this.data.memberProfileOverrides]
      .sort((a, b) => (a.member_id < b.member_id ? -1 : a.member_id > b.member_id ? 1 : 0))
      .map(({ member_id, bio, instagram_url, facebook_url, twitter_url }) => ({ member_id, bio, instagram_url, facebook_url, twitter_url }));
  }

  async saveProfileOverride(memberId: string, fields: Partial<ProfileOverrideFields>, updatedBy: string) {
    if (!this.memberExists(memberId)) throw new Error("violates foreign key constraint on member_id");
    const existing = this.data.memberProfileOverrides.find((p) => p.member_id === memberId);
    if (existing) {
      Object.assign(existing, stripUndefined(fields), { updated_by: updatedBy, updated_at: this.now() });
      return;
    }
    this.data.memberProfileOverrides.push({
      member_id: memberId,
      bio: null,
      instagram_url: null,
      facebook_url: null,
      twitter_url: null,
      created_at: this.now(),
      updated_at: this.now(),
      ...stripUndefined(fields),
      updated_by: updatedBy,
    });
  }
}

/** PostgREST leaves out a key whose value is undefined; so does the twin. */
function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
