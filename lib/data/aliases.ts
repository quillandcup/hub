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
}

/** The stored rows the twin keeps; the scans return the matcher shapes. */
export type NameAliasRow = MemberAlias & { id: string; active: boolean };
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
}
