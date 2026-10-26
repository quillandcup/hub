import { fetchAllRows } from "@/lib/supabase/paginate";
import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** A name a member is known by elsewhere (in Zoom, in Slack), matched against attendee names. */
export interface MemberAlias {
  member_id: string;
  alias: string;
  /** 'zoom' or 'slack' (the column is plain text with a check constraint). */
  source: string;
}

/** An extra email address a member uses, with the canonical form it is matched by. */
export interface MemberEmailAlias {
  alias_email: string;
  canonical_email: string;
}

/** One of a member's own name aliases, as their settings page lists it. */
export interface MemberNameAlias {
  id: string;
  alias: string;
  source: string;
  active: boolean;
  createdAt: string;
}

/**
 * The identity aliases that tie external names and emails to members: the stored side of member
 * matching (lib/member-matching.ts). This first slice is the read side every matcher needs, as
 * the shapes the matchers already take; the per-member lists and the writes follow.
 * Reads throw on a database error: a failed read must not look like "no aliases", which would
 * make everyone unmatched.
 */
export interface AliasRepository {
  /** Every name alias (optionally only active ones), paginated. */
  nameAliases(options?: { activeOnly?: boolean }): Promise<MemberAlias[]>;
  /** Every email alias (optionally only active ones), paginated. */
  emailAliases(options?: { activeOnly?: boolean }): Promise<MemberEmailAlias[]>;
  /** How many name aliases there are. */
  nameAliasCount(): Promise<number>;
  /** A member's name aliases, newest first. */
  namesOf(memberId: string): Promise<MemberNameAlias[]>;
  /** The member's alias with exactly this text, or null. */
  findName(memberId: string, alias: string): Promise<Pick<MemberNameAlias, "id" | "active"> | null>;
  /** Adds a name alias; false when that text is already taken (aliases are unique across all members). */
  addName(memberId: string, alias: string, source: string): Promise<boolean>;
  /** Turns the member's own alias on or off; false when the id isn't theirs. Never a hard delete. */
  setNameActive(memberId: string, id: string, active: boolean): Promise<boolean>;
}

type Page<T> = { data: T[] | null; error: { message: string } | null };

export class SupabaseAliasRepository implements AliasRepository {
  constructor(private readonly db: Db) {}

  async nameAliases({ activeOnly = false }: { activeOnly?: boolean } = {}): Promise<MemberAlias[]> {
    return fetchAllRows<MemberAlias>((from, to) => {
      let query = this.db.from("member_name_aliases").select("alias, member_id, source");
      if (activeOnly) query = query.eq("active", true);
      return query.order("id").range(from, to) as unknown as PromiseLike<Page<MemberAlias>>;
    });
  }

  async emailAliases({ activeOnly = false }: { activeOnly?: boolean } = {}): Promise<MemberEmailAlias[]> {
    return fetchAllRows<MemberEmailAlias>((from, to) => {
      let query = this.db.from("member_email_aliases").select("alias_email, canonical_email");
      if (activeOnly) query = query.eq("active", true);
      return query.order("id").range(from, to) as unknown as PromiseLike<Page<MemberEmailAlias>>;
    });
  }

  async nameAliasCount(): Promise<number> {
    const { count, error } = await this.db.from("member_name_aliases").select("id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async namesOf(memberId: string): Promise<MemberNameAlias[]> {
    const { data, error } = await this.db
      .from("member_name_aliases")
      .select("id, alias, source, active, created_at")
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ id: r.id, alias: r.alias, source: r.source, active: r.active, createdAt: r.created_at ?? "" }));
  }

  async findName(memberId: string, alias: string) {
    const { data, error } = await this.db.from("member_name_aliases").select("id, active").eq("member_id", memberId).eq("alias", alias).maybeSingle();
    if (error) throw new Error(error.message);
    return data ?? null;
  }

  async addName(memberId: string, alias: string, source: string): Promise<boolean> {
    const { error } = await this.db.from("member_name_aliases").insert({ member_id: memberId, alias, source });
    if (error?.code === "23505") return false;
    if (error) throw new Error(error.message);
    return true;
  }

  async setNameActive(memberId: string, id: string, active: boolean): Promise<boolean> {
    const { data, error } = await this.db.from("member_name_aliases").update({ active }).eq("id", id).eq("member_id", memberId).select("id");
    if (error) throw new Error(error.message);
    return (data?.length ?? 0) > 0;
  }
}

/** The stored rows the twin keeps; the scans return the matcher shapes. */
export type NameAliasRow = MemberAlias & { id: string; active: boolean; createdAt?: string };
export type EmailAliasRow = MemberEmailAlias & { id: string; memberId: string; active: boolean };

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryAliasRepository implements AliasRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async nameAliases({ activeOnly = false }: { activeOnly?: boolean } = {}) {
    return this.data.nameAliases.filter((a) => !activeOnly || a.active).map(({ member_id, alias, source }) => ({ member_id, alias, source }));
  }

  async emailAliases({ activeOnly = false }: { activeOnly?: boolean } = {}) {
    return this.data.emailAliases.filter((a) => !activeOnly || a.active).map(({ alias_email, canonical_email }) => ({ alias_email, canonical_email }));
  }

  async nameAliasCount() {
    return this.data.nameAliases.length;
  }

  async namesOf(memberId: string) {
    return this.data.nameAliases
      .filter((a) => a.member_id === memberId)
      .map((a) => ({ id: a.id, alias: a.alias, source: a.source, active: a.active, createdAt: a.createdAt ?? new Date(0).toISOString() }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
  }

  async findName(memberId: string, alias: string) {
    const row = this.data.nameAliases.find((a) => a.member_id === memberId && a.alias === alias);
    return row ? { id: row.id, active: row.active } : null;
  }

  async addName(memberId: string, alias: string, source: string) {
    if (this.data.nameAliases.some((a) => a.alias === alias)) return false;
    // Strictly after every earlier one, like the database's clock, so "newest first" never ties.
    const latest = Math.max(0, ...this.data.nameAliases.map((a) => (a.createdAt ? Date.parse(a.createdAt) : 0)));
    this.data.nameAliases.push({
      id: `nal_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      member_id: memberId,
      alias,
      source,
      active: true,
      createdAt: new Date(Math.max(Date.now(), latest + 1)).toISOString(),
    });
    return true;
  }

  async setNameActive(memberId: string, id: string, active: boolean) {
    const row = this.data.nameAliases.find((a) => a.id === id && a.member_id === memberId);
    if (!row) return false;
    row.active = active;
    return true;
  }
}
