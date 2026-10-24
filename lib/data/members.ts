import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import type { Db } from "./db";
import type { InMemoryDataset, MemberSeed } from "./in-memory";

/** Ids per `.in(...)` filter, so the request URL stays under the length limit even with long ids. */
const ID_CHUNK_SIZE = 100;

/** Who a member is, enough to match them against external names and emails and to greet them. */
export type MemberIdentity = { id: string; name: string; displayName: string | null; email: string };

/** A member's record, without the profile and raw-import columns. */
export type Member = MemberIdentity & {
  status: string;
  source: string;
  /** The Supabase Auth user this member signs in as; null until they have an account. */
  userId: string | null;
  staffRole: string | null;
  /** The contact id in Kajabi, if the member has one. */
  kajabiId: string | null;
  stripeCustomerId: string | null;
  /** Profile photo URL, if they have one. */
  photoUrl: string | null;
  joinedAt: string;
  firstJoinedAt: string | null;
  mostRecentJoinedAt: string | null;
};

/** What a member keeps about themselves: the profile and identity settings columns. */
export type MemberProfile = {
  id: string;
  name: string;
  displayName: string | null;
  email: string;
  kajabiId: string | null;
  bio: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  twitterUrl: string | null;
  birthdayMonth: number | null;
  birthdayDay: number | null;
  /** Set once the member has used their one self-service name change. */
  selfServiceNameChangedAt: string | null;
};

/** Which members a search matches; all given conditions must hold. Results are ordered by name. */
export type MemberSearch = {
  /** Each word must appear, in any case, in the name or the email. */
  words?: string[];
  /** The email, ignoring case, is exactly this. */
  emailEquals?: string;
  /** The email contains this, in any case. */
  emailContains?: string;
  status?: string;
  limit?: number;
  offset?: number;
};

/**
 * Everything the app asks of `members`. Scans are paginated here (a members table past 1000 rows
 * is silently truncated by a bare select), and lookups by id or auth user are chunked.
 */
export interface MemberRepository {
  /** Every member's identity (optionally one status), ordered by id. For matching and rosters. */
  identities(options?: { status?: string }): Promise<MemberIdentity[]>;
  /**
   * Every member (optionally one status), paginated, ordered by id or by name. For admin lists and
   * reports; use `identities` when only the name and email are needed.
   */
  list(options?: { status?: string; orderBy?: "id" | "name" }): Promise<Member[]>;
  /** How many members there are in total. */
  count(): Promise<number>;
  /** The members whose email is one of these (exact, as stored), in no particular order. */
  byEmails(emails: string[]): Promise<Member[]>;
  byId(id: string): Promise<Member | null>;
  /** The members that exist among these ids, in no particular order. */
  byIds(ids: string[]): Promise<Member[]>;
  /** The member who signs in as this Supabase Auth user. */
  byUserId(userId: string): Promise<Member | null>;
  /** The member's profile and identity-settings columns. */
  profile(id: string): Promise<MemberProfile | null>;
  /** Members matching the search, by name (then id). */
  search(query: MemberSearch): Promise<Member[]>;
  /** When Kajabi processing last touched a Kajabi member's row, or null if there are none. */
  lastKajabiProcessedAt(): Promise<string | null>;
  /** How many members of this status have no Stripe customer id. */
  countWithoutStripeCustomer(status: string): Promise<number>;
  /** The member with exactly this email (case-sensitive, as stored), if any. */
  byEmail(email: string): Promise<Member | null>;
  /** Auth user id -> member id, for the auth users that have a member. */
  idsByUserId(userIds: string[]): Promise<Map<string, string>>;
  /** Member id -> auth user id (null: no account yet), for the members that exist. */
  userIdsByMemberId(memberIds: string[]): Promise<Map<string, string | null>>;
  /** How many members have this status. */
  countByStatus(status: string): Promise<number>;
  /** How many members there are with each status (statuses nobody has are absent). */
  countsByStatus(): Promise<Map<string, number>>;
}

const IDENTITY_COLUMNS = "id, name, display_name, email";
const MEMBER_COLUMNS = `${IDENTITY_COLUMNS}, status, source, user_id, staff_role, kajabi_id, stripe_customer_id, photo_url, joined_at, first_joined_at, most_recent_joined_at`;

type IdentityRow = { id: string; name: string; display_name: string | null; email: string };
type MemberRow = IdentityRow & {
  status: string;
  source: string;
  user_id: string | null;
  staff_role: string | null;
  kajabi_id: string | null;
  stripe_customer_id: string | null;
  photo_url: string | null;
  joined_at: string;
  first_joined_at: string | null;
  most_recent_joined_at: string | null;
};
type Page<T> = { data: T[] | null; error: { message: string } | null };

const toIdentity = (row: IdentityRow): MemberIdentity => ({
  id: row.id,
  name: row.name,
  displayName: row.display_name,
  email: row.email,
});

const toMember = (row: MemberRow): Member => ({
  ...toIdentity(row),
  status: row.status,
  source: row.source,
  userId: row.user_id,
  staffRole: row.staff_role,
  kajabiId: row.kajabi_id,
  stripeCustomerId: row.stripe_customer_id,
  photoUrl: row.photo_url,
  joinedAt: row.joined_at,
  firstJoinedAt: row.first_joined_at,
  mostRecentJoinedAt: row.most_recent_joined_at,
});

const PROFILE_COLUMNS =
  "id, name, display_name, email, kajabi_id, bio, instagram_url, facebook_url, twitter_url, birthday_month, birthday_day, self_service_name_changed_at";
type ProfileRow = IdentityRow & {
  kajabi_id: string | null;
  bio: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  twitter_url: string | null;
  birthday_month: number | null;
  birthday_day: number | null;
  self_service_name_changed_at: string | null;
};

const toProfile = (row: ProfileRow): MemberProfile => ({
  ...toIdentity(row),
  kajabiId: row.kajabi_id,
  bio: row.bio,
  instagramUrl: row.instagram_url,
  facebookUrl: row.facebook_url,
  twitterUrl: row.twitter_url,
  birthdayMonth: row.birthday_month,
  birthdayDay: row.birthday_day,
  selfServiceNameChangedAt: row.self_service_name_changed_at,
});

/** A typed word with the characters that mean something to PostgREST's filter syntax or to LIKE turned into spaces. */
const neutralize = (word: string) => word.replace(/[\\%_,()"]/g, " ").trim();
/** Text for ILIKE to match literally: its own wildcards escaped. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

export class SupabaseMemberRepository implements MemberRepository {
  constructor(private readonly db: Db) {}

  async identities({ status }: { status?: string } = {}): Promise<MemberIdentity[]> {
    const rows = await fetchAllRows<IdentityRow>((from, to) => {
      let query = this.db.from("members").select(IDENTITY_COLUMNS);
      if (status !== undefined) query = query.eq("status", status);
      return query.order("id").range(from, to) as unknown as PromiseLike<Page<IdentityRow>>;
    });
    return rows.map(toIdentity);
  }

  async list({ status, orderBy = "id" }: { status?: string; orderBy?: "id" | "name" } = {}): Promise<Member[]> {
    const rows = await fetchAllRows<MemberRow>((from, to) => {
      let query = this.db.from("members").select(MEMBER_COLUMNS);
      if (status !== undefined) query = query.eq("status", status);
      // `id` last so paging has a total order even when names repeat.
      return (orderBy === "name" ? query.order("name").order("id") : query.order("id")).range(from, to) as unknown as PromiseLike<Page<MemberRow>>;
    });
    return rows.map(toMember);
  }

  async count(): Promise<number> {
    const { count, error } = await this.db.from("members").select("id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async byEmails(emails: string[]): Promise<Member[]> {
    const found: Member[] = [];
    for (const emailChunk of chunk(emails, ID_CHUNK_SIZE)) {
      const rows = await fetchAllRows<MemberRow>(
        (from, to) =>
          this.db.from("members").select(MEMBER_COLUMNS).in("email", emailChunk).order("id").range(from, to) as unknown as PromiseLike<Page<MemberRow>>,
      );
      found.push(...rows.map(toMember));
    }
    return found;
  }

  async profile(id: string): Promise<MemberProfile | null> {
    const { data, error } = await this.db.from("members").select(PROFILE_COLUMNS).eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toProfile(data as unknown as ProfileRow) : null;
  }

  async search({ words = [], emailEquals, emailContains, status, limit, offset = 0 }: MemberSearch): Promise<Member[]> {
    let query = this.db.from("members").select(MEMBER_COLUMNS);
    for (const word of words) {
      const clean = neutralize(word);
      if (clean) query = query.or(`name.ilike."%${clean}%",email.ilike."%${clean}%"`);
    }
    if (emailEquals !== undefined) query = query.ilike("email", escapeLike(emailEquals));
    if (emailContains !== undefined) query = query.ilike("email", `%${escapeLike(emailContains)}%`);
    if (status !== undefined) query = query.eq("status", status);
    query = query.order("name").order("id");
    if (limit !== undefined) query = query.range(offset, offset + limit - 1);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as MemberRow[]).map(toMember);
  }

  async lastKajabiProcessedAt(): Promise<string | null> {
    const { data, error } = await this.db
      .from("members")
      .select("updated_at")
      .not("kajabi_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.updated_at ?? null;
  }

  async countWithoutStripeCustomer(status: string): Promise<number> {
    const { count, error } = await this.db
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("status", status)
      .is("stripe_customer_id", null);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async byId(id: string): Promise<Member | null> {
    const { data, error } = await this.db.from("members").select(MEMBER_COLUMNS).eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toMember(data as unknown as MemberRow) : null;
  }

  async byIds(ids: string[]): Promise<Member[]> {
    const found: Member[] = [];
    for (const idChunk of chunk(ids, ID_CHUNK_SIZE)) {
      const rows = await fetchAllRows<MemberRow>(
        (from, to) =>
          this.db.from("members").select(MEMBER_COLUMNS).in("id", idChunk).order("id").range(from, to) as unknown as PromiseLike<Page<MemberRow>>,
      );
      found.push(...rows.map(toMember));
    }
    return found;
  }

  async byUserId(userId: string): Promise<Member | null> {
    const { data, error } = await this.db.from("members").select(MEMBER_COLUMNS).eq("user_id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toMember(data as unknown as MemberRow) : null;
  }

  async byEmail(email: string): Promise<Member | null> {
    const { data, error } = await this.db.from("members").select(MEMBER_COLUMNS).eq("email", email).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toMember(data as unknown as MemberRow) : null;
  }

  async idsByUserId(userIds: string[]): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (const userChunk of chunk(userIds, ID_CHUNK_SIZE)) {
      const rows = await fetchAllRows<{ id: string; user_id: string | null }>(
        (from, to) =>
          this.db.from("members").select("id, user_id").in("user_id", userChunk).order("id").range(from, to) as unknown as PromiseLike<
            Page<{ id: string; user_id: string | null }>
          >,
      );
      for (const row of rows) if (row.user_id) ids.set(row.user_id, row.id);
    }
    return ids;
  }

  async userIdsByMemberId(memberIds: string[]): Promise<Map<string, string | null>> {
    const userIds = new Map<string, string | null>();
    for (const idChunk of chunk(memberIds, ID_CHUNK_SIZE)) {
      const rows = await fetchAllRows<{ id: string; user_id: string | null }>(
        (from, to) =>
          this.db.from("members").select("id, user_id").in("id", idChunk).order("id").range(from, to) as unknown as PromiseLike<
            Page<{ id: string; user_id: string | null }>
          >,
      );
      for (const row of rows) userIds.set(row.id, row.user_id);
    }
    return userIds;
  }

  async countsByStatus(): Promise<Map<string, number>> {
    const rows = await fetchAllRows<{ status: string }>(
      (from, to) => this.db.from("members").select("status").order("id").range(from, to) as unknown as PromiseLike<Page<{ status: string }>>,
    );
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    return counts;
  }

  async countByStatus(status: string): Promise<number> {
    const { count, error } = await this.db.from("members").select("id", { count: "exact", head: true }).eq("status", status);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
}

function fromSeed(seed: MemberSeed): Member {
  return {
    id: seed.id,
    name: seed.name,
    displayName: seed.displayName ?? null,
    email: seed.email ?? "",
    status: seed.status ?? "active",
    source: seed.source ?? "kajabi",
    userId: seed.userId ?? null,
    staffRole: seed.staffRole ?? null,
    kajabiId: seed.kajabiId ?? null,
    stripeCustomerId: seed.stripeCustomerId ?? null,
    photoUrl: seed.photoUrl ?? null,
    joinedAt: seed.joinedAt ?? "2026-01-01",
    firstJoinedAt: seed.firstJoinedAt ?? null,
    mostRecentJoinedAt: seed.mostRecentJoinedAt ?? null,
  };
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryMemberRepository implements MemberRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private all(): Member[] {
    return this.data.members.map(fromSeed);
  }

  async identities({ status }: { status?: string } = {}) {
    return this.all()
      .filter((m) => status === undefined || m.status === status)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ id, name, displayName, email }) => ({ id, name, displayName, email }));
  }

  async list({ status, orderBy = "id" }: { status?: string; orderBy?: "id" | "name" } = {}) {
    return this.all()
      .filter((m) => status === undefined || m.status === status)
      .sort((a, b) => (orderBy === "name" ? a.name.localeCompare(b.name) : 0) || a.id.localeCompare(b.id));
  }

  async count() {
    return this.data.members.length;
  }

  async profile(id: string) {
    const m = this.data.members.find((x) => x.id === id);
    if (!m) return null;
    return {
      id: m.id,
      name: m.name,
      displayName: m.displayName ?? null,
      email: m.email ?? "",
      kajabiId: m.kajabiId ?? null,
      bio: m.bio ?? null,
      instagramUrl: m.instagramUrl ?? null,
      facebookUrl: m.facebookUrl ?? null,
      twitterUrl: m.twitterUrl ?? null,
      birthdayMonth: m.birthdayMonth ?? null,
      birthdayDay: m.birthdayDay ?? null,
      selfServiceNameChangedAt: m.selfServiceNameChangedAt ?? null,
    };
  }

  async search({ words = [], emailEquals, emailContains, status, limit, offset = 0 }: MemberSearch) {
    const matches = (text: string, word: string) => text.toLowerCase().includes(neutralize(word).toLowerCase());
    const found = this.all()
      .filter((m) => words.every((w) => !neutralize(w) || matches(m.name, w) || matches(m.email, w)))
      .filter((m) => emailEquals === undefined || m.email.toLowerCase() === emailEquals.toLowerCase())
      .filter((m) => emailContains === undefined || m.email.toLowerCase().includes(emailContains.toLowerCase()))
      .filter((m) => status === undefined || m.status === status)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return limit === undefined ? found : found.slice(offset, offset + limit);
  }

  async lastKajabiProcessedAt() {
    const times = this.data.members.filter((m) => m.kajabiId).map((m) => m.updatedAt).filter((t): t is string => !!t);
    if (times.length === 0) return null;
    return times.reduce((latest, t) => (new Date(t) > new Date(latest) ? t : latest));
  }

  async countWithoutStripeCustomer(status: string) {
    return this.all().filter((m) => m.status === status && m.stripeCustomerId === null).length;
  }

  async byEmails(emails: string[]) {
    const wanted = new Set(emails);
    return this.all().filter((m) => wanted.has(m.email));
  }

  async byId(id: string) {
    return this.all().find((m) => m.id === id) ?? null;
  }

  async byIds(ids: string[]) {
    const wanted = new Set(ids);
    return this.all().filter((m) => wanted.has(m.id));
  }

  async byUserId(userId: string) {
    return this.all().find((m) => m.userId === userId) ?? null;
  }

  async byEmail(email: string) {
    return this.all().find((m) => m.email === email) ?? null;
  }

  async idsByUserId(userIds: string[]) {
    const wanted = new Set(userIds);
    const ids = new Map<string, string>();
    for (const m of this.all()) if (m.userId && wanted.has(m.userId)) ids.set(m.userId, m.id);
    return ids;
  }

  async userIdsByMemberId(memberIds: string[]) {
    const wanted = new Set(memberIds);
    return new Map(this.all().filter((m) => wanted.has(m.id)).map((m) => [m.id, m.userId] as const));
  }

  async countByStatus(status: string) {
    return this.all().filter((m) => m.status === status).length;
  }

  async countsByStatus() {
    const counts = new Map<string, number>();
    for (const m of this.all()) counts.set(m.status, (counts.get(m.status) ?? 0) + 1);
    return counts;
  }
}
