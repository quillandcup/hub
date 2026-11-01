import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import { escapeLike } from "./query";
import type { Db, Insert } from "./db";
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

/** Ids per `.in(...)` write or lookup, so the request URL stays under the length limit. */
const ID_CHUNK = 100;

/** A name alias with the member who owns it, for the admin list of everyone's aliases. */
export interface NameAliasWithMember {
  id: string;
  alias: string;
  createdAt: string;
  member: { id: string; name: string; email: string; status: string };
}

/** One of a member's own email aliases, as their settings page and the admin page list it. */
export interface MemberEmailAliasEntry {
  id: string;
  alias_email: string;
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
  /** Every name alias with its member, by alias text, paginated. */
  namesWithMembers(): Promise<NameAliasWithMember[]>;
  /** One name alias by id, or null. */
  nameById(id: string): Promise<{ id: string; memberId: string; alias: string } | null>;
  /** The active Slack user ids (alias text) these members are linked to, one row per link. */
  slackLinks(memberIds: string[]): Promise<{ member_id: string; alias: string }[]>;
  /** Adds several name aliases in one statement: all or nothing, throws if any text is taken. Returns how many were added. */
  addNames(rows: { memberId: string; alias: string; source: string }[]): Promise<number>;
  /** A member's name aliases, newest first. */
  namesOf(memberId: string): Promise<MemberNameAlias[]>;
  /** The member's alias with exactly this text, or null. */
  findName(memberId: string, alias: string): Promise<Pick<MemberNameAlias, "id" | "active"> | null>;
  /** Adds a name alias; false when that text is already taken (aliases are unique across all members). */
  addName(memberId: string, alias: string, source: string): Promise<boolean>;
  /** Turns the member's own alias on or off; false when the id isn't theirs. Never a hard delete. */
  setNameActive(memberId: string, id: string, active: boolean): Promise<boolean>;

  /** Which member each active email alias belongs to, paginated. */
  emailOwners(): Promise<{ alias_email: string; member_id: string }[]>;
  /** These members' email aliases (all, active or not), one row per alias. */
  emailsOfMembers(memberIds: string[]): Promise<{ member_id: string; alias_email: string }[]>;
  /** The active aliases that resolve to this primary email. */
  activeEmailsFor(canonicalEmail: string): Promise<string[]>;
  /** The member behind the one active alias with this address (any case); null when none or several match. */
  uniqueActiveEmailOwner(email: string): Promise<string | null>;
  /** A member's email aliases, newest first. */
  emailsOf(memberId: string): Promise<MemberEmailAliasEntry[]>;
  /** Adds an email alias (the database fills in the canonical email); false when that address is already an alias of anyone. */
  addEmail(memberId: string, email: string, source: string): Promise<boolean>;
  /** Turns the member's own email alias on or off; false when the id isn't theirs. */
  setEmailActive(memberId: string, id: string, active: boolean): Promise<boolean>;
  /** Deletes the member's alias with this exact address, if they have it. */
  removeEmailOf(memberId: string, address: string): Promise<void>;

  // Admin identity fixes (merge, split, move aliases). Aliases are unique across all members, so a
  // move to a member who already has the text is the caller's to avoid (see `namesOf`).
  /** Which of these name alias ids belong to the member. */
  ownedNameIds(memberId: string, ids: string[]): Promise<string[]>;
  /** The member's email aliases among these ids. */
  ownedEmails(memberId: string, ids: string[]): Promise<{ id: string; alias_email: string }[]>;
  /** Who holds this exact email alias, or null. */
  findEmail(address: string): Promise<{ id: string; memberId: string } | null>;
  /** Re-files these name aliases under another member. */
  moveNames(ids: string[], toMemberId: string): Promise<void>;
  /** Re-files these email aliases under another member. */
  moveEmails(ids: string[], toMemberId: string): Promise<void>;
  /** Re-files every email alias of one member under another. */
  moveAllEmails(fromMemberId: string, toMemberId: string): Promise<void>;
  /** Deletes these name aliases. */
  removeNames(ids: string[]): Promise<void>;
  /** Deletes these email aliases. */
  removeEmails(ids: string[]): Promise<void>;
  /** Gives the member this name alias, taking it over if another member had it. */
  upsertName(memberId: string, alias: string, source: string): Promise<void>;
  /** Gives the member this email alias, taking it over if another member had it (the database fills in the canonical email). With `active`, also switches it on or off. */
  upsertEmail(memberId: string, email: string, source: string, active?: boolean): Promise<void>;
}


export class SupabaseAliasRepository implements AliasRepository {
  constructor(private readonly db: Db) {}

  async nameAliases({ activeOnly = false }: { activeOnly?: boolean } = {}): Promise<MemberAlias[]> {
    return fetchAllRows<MemberAlias>((from, to) => {
      let query = this.db.from("member_name_aliases").select("alias, member_id, source");
      if (activeOnly) query = query.eq("active", true);
      return query.order("id").range(from, to);
    });
  }

  async emailAliases({ activeOnly = false }: { activeOnly?: boolean } = {}): Promise<MemberEmailAlias[]> {
    return fetchAllRows<MemberEmailAlias>((from, to) => {
      let query = this.db.from("member_email_aliases").select("alias_email, canonical_email");
      if (activeOnly) query = query.eq("active", true);
      return query.order("id").range(from, to);
    });
  }

  async nameAliasCount(): Promise<number> {
    const { count, error } = await this.db.from("member_name_aliases").select("id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async namesWithMembers(): Promise<NameAliasWithMember[]> {
    type Row = { id: string; alias: string; created_at: string | null; member: { id: string; name: string; email: string | null; status: string } | null };
    const rows = await fetchAllRows<Row>(
      (from, to) =>
        this.db
          .from("member_name_aliases")
          .select("id, alias, created_at, member:members(id, name, email, status)")
          .order("alias")
          .order("id")
          .range(from, to)
    );
    return rows.flatMap((r) => (r.member ? [{ id: r.id, alias: r.alias, createdAt: r.created_at ?? "", member: { ...r.member, email: r.member.email ?? "" } }] : []));
  }

  async nameById(id: string) {
    const { data, error } = await this.db.from("member_name_aliases").select("id, member_id, alias").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { id: data.id, memberId: data.member_id, alias: data.alias } : null;
  }

  async slackLinks(memberIds: string[]) {
    const links: { member_id: string; alias: string }[] = [];
    for (const part of chunk(memberIds, ID_CHUNK)) {
      const { data, error } = await this.db.from("member_name_aliases").select("member_id, alias").in("member_id", part).eq("source", "slack").eq("active", true);
      if (error) throw new Error(error.message);
      links.push(...(data ?? []));
    }
    return links;
  }

  async addNames(rows: { memberId: string; alias: string; source: string }[]) {
    if (rows.length === 0) return 0;
    const { data, error } = await this.db
      .from("member_name_aliases")
      .insert(rows.map((r) => ({ member_id: r.memberId, alias: r.alias, source: r.source })))
      .select("id");
    if (error) throw new Error(error.message);
    return data?.length ?? 0;
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

  async emailOwners() {
    type Row = { alias_email: string; member_id: string };
    return fetchAllRows<Row>(
      (from, to) => this.db.from("member_email_aliases").select("alias_email, member_id").eq("active", true).order("id").range(from, to)
    );
  }

  async emailsOfMembers(memberIds: string[]) {
    type Row = { member_id: string; alias_email: string };
    const rows: Row[] = [];
    for (const part of chunk(memberIds, ID_CHUNK)) {
      rows.push(
        ...(await fetchAllRows<Row>(
          (from, to) => this.db.from("member_email_aliases").select("member_id, alias_email").in("member_id", part).order("id").range(from, to)
        ))
      );
    }
    return rows;
  }

  async activeEmailsFor(canonicalEmail: string) {
    const { data, error } = await this.db.from("member_email_aliases").select("alias_email").eq("canonical_email", canonicalEmail).eq("active", true);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.alias_email);
  }

  async uniqueActiveEmailOwner(email: string) {
    const { data, error } = await this.db.from("member_email_aliases").select("member_id").ilike("alias_email", escapeLike(email)).eq("active", true).limit(2);
    if (error) throw new Error(error.message);
    return data?.length === 1 ? data[0].member_id : null;
  }

  async emailsOf(memberId: string): Promise<MemberEmailAliasEntry[]> {
    const { data, error } = await this.db
      .from("member_email_aliases")
      .select("id, alias_email, source, active, created_at")
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ id: r.id, alias_email: r.alias_email, source: r.source, active: r.active, createdAt: r.created_at ?? "" }));
  }

  async addEmail(memberId: string, email: string, source: string): Promise<boolean> {
    const { error } = await this.db
      .from("member_email_aliases")
      .insert({ member_id: memberId, alias_email: email, source } as Insert<"member_email_aliases">); // canonical_email: the trigger
    if (error?.code === "23505") return false;
    if (error) throw new Error(error.message);
    return true;
  }

  async setEmailActive(memberId: string, id: string, active: boolean): Promise<boolean> {
    const { data, error } = await this.db.from("member_email_aliases").update({ active }).eq("id", id).eq("member_id", memberId).select("id");
    if (error) throw new Error(error.message);
    return (data?.length ?? 0) > 0;
  }

  async removeEmailOf(memberId: string, address: string) {
    const { error } = await this.db.from("member_email_aliases").delete().eq("member_id", memberId).eq("alias_email", address);
    if (error) throw new Error(error.message);
  }

  async ownedNameIds(memberId: string, ids: string[]): Promise<string[]> {
    const owned: string[] = [];
    for (const part of chunk(ids, ID_CHUNK)) {
      const { data, error } = await this.db.from("member_name_aliases").select("id").eq("member_id", memberId).in("id", part);
      if (error) throw new Error(error.message);
      owned.push(...(data ?? []).map((r) => r.id));
    }
    return owned;
  }

  async ownedEmails(memberId: string, ids: string[]) {
    const owned: { id: string; alias_email: string }[] = [];
    for (const part of chunk(ids, ID_CHUNK)) {
      const { data, error } = await this.db.from("member_email_aliases").select("id, alias_email").eq("member_id", memberId).in("id", part);
      if (error) throw new Error(error.message);
      owned.push(...(data ?? []));
    }
    return owned;
  }

  async findEmail(address: string) {
    const { data, error } = await this.db.from("member_email_aliases").select("id, member_id").eq("alias_email", address).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { id: data.id, memberId: data.member_id } : null;
  }

  async moveNames(ids: string[], toMemberId: string) {
    for (const part of chunk(ids, ID_CHUNK)) {
      const { error } = await this.db.from("member_name_aliases").update({ member_id: toMemberId }).in("id", part);
      if (error) throw new Error(error.message);
    }
  }

  async moveEmails(ids: string[], toMemberId: string) {
    for (const part of chunk(ids, ID_CHUNK)) {
      const { error } = await this.db.from("member_email_aliases").update({ member_id: toMemberId }).in("id", part);
      if (error) throw new Error(error.message);
    }
  }

  async moveAllEmails(fromMemberId: string, toMemberId: string) {
    const { error } = await this.db.from("member_email_aliases").update({ member_id: toMemberId }).eq("member_id", fromMemberId);
    if (error) throw new Error(error.message);
  }

  async removeNames(ids: string[]) {
    for (const part of chunk(ids, ID_CHUNK)) {
      const { error } = await this.db.from("member_name_aliases").delete().in("id", part);
      if (error) throw new Error(error.message);
    }
  }

  async removeEmails(ids: string[]) {
    for (const part of chunk(ids, ID_CHUNK)) {
      const { error } = await this.db.from("member_email_aliases").delete().in("id", part);
      if (error) throw new Error(error.message);
    }
  }

  async upsertName(memberId: string, alias: string, source: string) {
    const { error } = await this.db.from("member_name_aliases").upsert({ member_id: memberId, alias, source }, { onConflict: "alias" });
    if (error) throw new Error(error.message);
  }

  async upsertEmail(memberId: string, email: string, source: string, active?: boolean) {
    const { error } = await this.db
      .from("member_email_aliases")
      .upsert({ member_id: memberId, alias_email: email, source, ...(active === undefined ? {} : { active }) } as Insert<"member_email_aliases">, { onConflict: "alias_email" }); // canonical_email: the trigger
    if (error) throw new Error(error.message);
  }
}

/** The stored rows the twin keeps; the scans return the matcher shapes. */
export type NameAliasRow = MemberAlias & { id: string; active: boolean; createdAt?: string };
export type EmailAliasRow = MemberEmailAlias & { id: string; memberId: string; active: boolean; source?: string; createdAt?: string };

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

  async namesWithMembers() {
    return this.data.nameAliases
      .flatMap((a) => {
        const m = this.data.members.find((x) => x.id === a.member_id);
        return m ? [{ id: a.id, alias: a.alias, createdAt: a.createdAt ?? new Date(0).toISOString(), member: { id: m.id, name: m.name, email: m.email ?? "", status: m.status ?? "active" } }] : [];
      })
      .sort((a, b) => (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : a.id < b.id ? -1 : 1));
  }

  async nameById(id: string) {
    const row = this.data.nameAliases.find((a) => a.id === id);
    return row ? { id: row.id, memberId: row.member_id, alias: row.alias } : null;
  }

  async slackLinks(memberIds: string[]) {
    const wanted = new Set(memberIds);
    return this.data.nameAliases.filter((a) => wanted.has(a.member_id) && a.source === "slack" && a.active).map((a) => ({ member_id: a.member_id, alias: a.alias }));
  }

  async addNames(rows: { memberId: string; alias: string; source: string }[]) {
    const taken = new Set(this.data.nameAliases.map((a) => a.alias));
    const incoming = rows.map((r) => r.alias);
    if (incoming.some((alias) => taken.has(alias)) || new Set(incoming).size !== incoming.length) throw new Error("duplicate key value violates unique constraint");
    for (const r of rows) await this.addName(r.memberId, r.alias, r.source);
    return rows.length;
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

  async emailOwners() {
    return this.data.emailAliases.filter((a) => a.active).map((a) => ({ alias_email: a.alias_email, member_id: a.memberId }));
  }

  async emailsOfMembers(memberIds: string[]) {
    const wanted = new Set(memberIds);
    return this.data.emailAliases.filter((a) => wanted.has(a.memberId)).map((a) => ({ member_id: a.memberId, alias_email: a.alias_email }));
  }

  async activeEmailsFor(canonicalEmail: string) {
    return this.data.emailAliases.filter((a) => a.canonical_email === canonicalEmail && a.active).map((a) => a.alias_email);
  }

  async uniqueActiveEmailOwner(email: string) {
    const matches = this.data.emailAliases.filter((a) => a.active && a.alias_email.toLowerCase() === email.toLowerCase());
    return matches.length === 1 ? matches[0].memberId : null;
  }

  async emailsOf(memberId: string) {
    return this.data.emailAliases
      .filter((a) => a.memberId === memberId)
      .map((a) => ({ id: a.id, alias_email: a.alias_email, source: a.source ?? "manual", active: a.active, createdAt: a.createdAt ?? new Date(0).toISOString() }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
  }

  async addEmail(memberId: string, email: string, source: string) {
    if (this.data.emailAliases.some((a) => a.alias_email === email)) return false;
    // Strictly after every earlier one, like the database's clock, so "newest first" never ties.
    const latest = Math.max(0, ...this.data.emailAliases.map((a) => (a.createdAt ? Date.parse(a.createdAt) : 0)));
    this.data.emailAliases.push({
      id: `eal_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      memberId,
      alias_email: email,
      canonical_email: this.primaryEmail(memberId),
      active: true,
      source,
      createdAt: new Date(Math.max(Date.now(), latest + 1)).toISOString(),
    });
    return true;
  }

  async setEmailActive(memberId: string, id: string, active: boolean) {
    const row = this.data.emailAliases.find((a) => a.id === id && a.memberId === memberId);
    if (!row) return false;
    row.active = active;
    return true;
  }

  async removeEmailOf(memberId: string, address: string) {
    this.data.emailAliases = this.data.emailAliases.filter((a) => !(a.memberId === memberId && a.alias_email === address));
  }

  async ownedNameIds(memberId: string, ids: string[]) {
    const wanted = new Set(ids);
    return this.data.nameAliases.filter((a) => a.member_id === memberId && wanted.has(a.id)).map((a) => a.id);
  }

  async ownedEmails(memberId: string, ids: string[]) {
    const wanted = new Set(ids);
    return this.data.emailAliases.filter((a) => a.memberId === memberId && wanted.has(a.id)).map((a) => ({ id: a.id, alias_email: a.alias_email }));
  }

  async findEmail(address: string) {
    const row = this.data.emailAliases.find((a) => a.alias_email === address);
    return row ? { id: row.id, memberId: row.memberId } : null;
  }

  async moveNames(ids: string[], toMemberId: string) {
    const wanted = new Set(ids);
    for (const a of this.data.nameAliases) if (wanted.has(a.id)) a.member_id = toMemberId;
  }

  async moveEmails(ids: string[], toMemberId: string) {
    const wanted = new Set(ids);
    for (const a of this.data.emailAliases) if (wanted.has(a.id)) this.refile(a, toMemberId);
  }

  async moveAllEmails(fromMemberId: string, toMemberId: string) {
    for (const a of this.data.emailAliases) if (a.memberId === fromMemberId) this.refile(a, toMemberId);
  }

  async removeNames(ids: string[]) {
    const gone = new Set(ids);
    this.data.nameAliases = this.data.nameAliases.filter((a) => !gone.has(a.id));
  }

  async removeEmails(ids: string[]) {
    const gone = new Set(ids);
    this.data.emailAliases = this.data.emailAliases.filter((a) => !gone.has(a.id));
  }

  async upsertName(memberId: string, alias: string, source: string) {
    const existing = this.data.nameAliases.find((a) => a.alias === alias);
    if (existing) Object.assign(existing, { member_id: memberId, source });
    else this.data.nameAliases.push({ id: `nal_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`, member_id: memberId, alias, source, active: true });
  }

  async upsertEmail(memberId: string, email: string, source: string, active?: boolean) {
    const existing = this.data.emailAliases.find((a) => a.alias_email === email);
    if (existing) {
      this.refile(existing, memberId);
      if (active !== undefined) existing.active = active;
      return;
    }
    this.data.emailAliases.push({ id: `eal_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`, memberId, alias_email: email, canonical_email: this.primaryEmail(memberId), active: active ?? true, source });
  }

  /** An email alias is canonicalized to its member's primary email (a database trigger), so moving it re-derives that. */
  private refile(alias: EmailAliasRow, memberId: string) {
    alias.memberId = memberId;
    alias.canonical_email = this.primaryEmail(memberId);
  }

  private primaryEmail(memberId: string) {
    return this.data.members.find((m) => m.id === memberId)?.email ?? "";
  }
}
