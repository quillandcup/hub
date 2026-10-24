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
  joinedAt: string;
  firstJoinedAt: string | null;
  mostRecentJoinedAt: string | null;
};

/**
 * Everything the app asks of `members`. Scans are paginated here (a members table past 1000 rows
 * is silently truncated by a bare select), and lookups by id or auth user are chunked.
 */
export interface MemberRepository {
  /** Every member's identity (optionally one status), ordered by id. For matching and rosters. */
  identities(options?: { status?: string }): Promise<MemberIdentity[]>;
  byId(id: string): Promise<Member | null>;
  /** The members that exist among these ids, in no particular order. */
  byIds(ids: string[]): Promise<Member[]>;
  /** The member who signs in as this Supabase Auth user. */
  byUserId(userId: string): Promise<Member | null>;
  /** The member with exactly this email (case-sensitive, as stored), if any. */
  byEmail(email: string): Promise<Member | null>;
  /** Auth user id -> member id, for the auth users that have a member. */
  idsByUserId(userIds: string[]): Promise<Map<string, string>>;
  /** Member id -> auth user id (null: no account yet), for the members that exist. */
  userIdsByMemberId(memberIds: string[]): Promise<Map<string, string | null>>;
  /** How many members have this status. */
  countByStatus(status: string): Promise<number>;
}

const IDENTITY_COLUMNS = "id, name, display_name, email";
const MEMBER_COLUMNS = `${IDENTITY_COLUMNS}, status, source, user_id, staff_role, joined_at, first_joined_at, most_recent_joined_at`;

type IdentityRow = { id: string; name: string; display_name: string | null; email: string };
type MemberRow = IdentityRow & {
  status: string;
  source: string;
  user_id: string | null;
  staff_role: string | null;
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
  joinedAt: row.joined_at,
  firstJoinedAt: row.first_joined_at,
  mostRecentJoinedAt: row.most_recent_joined_at,
});

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
}
