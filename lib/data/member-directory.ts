import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** A member's public profile, as the directory holds it (readable by any signed-in member; no email, status or ids of other systems). */
export type DirectoryRow = Row<"member_directory">;

const ID_CHUNK = 100;

/** `%` and `_` are wildcards in a LIKE; the person typing meant the letters. */
const literalLike = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** A word as a quoted PostgREST ilike pattern for use inside `.or(...)`, with its wildcards and separators neutralized. */
const orPattern = (word: string) => `"%${word.replace(/[\\%_,()"]/g, " ").trim()}%"`;

/**
 * The member directory: the public profile fields of every member (name, display name, photo, bio,
 * socials, join dates), kept in step with `members` by a trigger and readable by any signed-in
 * member, which is why other members' pages and searches read it rather than `members`. Every method
 * throws on a database error.
 */
export interface MemberDirectoryRepository {
  /** One member's public profile, or null when there is none visible to the caller. */
  byId(id: string): Promise<DirectoryRow | null>;
  /** These members' public profiles (members without one are left out). Chunked, so any number of ids is fine. */
  byIds(ids: string[]): Promise<DirectoryRow[]>;
  /** Every member's public profile, by name then id. Paginated. */
  all(): Promise<DirectoryRow[]>;
  /** Members whose name or display name contains what was typed (as plain letters, wildcards included), by name, at most `limit`. */
  matching(typed: string, limit: number): Promise<DirectoryRow[]>;
  /** The ids of {@link matching}, for "from this person" filters. */
  idsMatching(typed: string, limit: number): Promise<string[]>;
  /**
   * Members matching every word: each word in the name, display name or bio, or the member among
   * that word's `alsoIds` (e.g. those whose alias matched). By name, one page.
   */
  searchWords(words: { text: string; alsoIds: string[] }[], page: { offset: number; limit: number }): Promise<DirectoryRow[]>;
}

export class SupabaseMemberDirectoryRepository implements MemberDirectoryRepository {
  constructor(private readonly db: Db) {}

  async byId(id: string) {
    const { data, error } = await this.db.from("member_directory").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async byIds(ids: string[]) {
    const rows: DirectoryRow[] = [];
    for (const part of chunk([...new Set(ids)], ID_CHUNK)) {
      const { data, error } = await this.db.from("member_directory").select("*").in("id", part);
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
    }
    return rows;
  }

  async all() {
    return fetchAllRows<DirectoryRow>(
      (from, to) =>
        this.db.from("member_directory").select("*").order("name").order("id").range(from, to) as unknown as PromiseLike<{
          data: DirectoryRow[] | null;
          error: { message: string } | null;
        }>
    );
  }

  async matching(typed: string, limit: number) {
    // Two queries, not one .or("name.ilike...,display_name.ilike..."): what was typed would have to be escaped
    // for PostgREST's filter syntax, and a comma or a parenthesis in it would start a filter of its own.
    const pattern = literalLike(typed);
    const [byName, byDisplayName] = await Promise.all([
      this.db.from("member_directory").select("*").ilike("name", pattern).order("name").order("id").limit(limit),
      this.db.from("member_directory").select("*").ilike("display_name", pattern).order("name").order("id").limit(limit),
    ]);
    if (byName.error) throw new Error(byName.error.message);
    if (byDisplayName.error) throw new Error(byDisplayName.error.message);
    const merged = new Map([...(byName.data ?? []), ...(byDisplayName.data ?? [])].map((m) => [m.id, m]));
    return [...merged.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1)).slice(0, limit);
  }

  async idsMatching(typed: string, limit: number) {
    return (await this.matching(typed, limit)).map((m) => m.id);
  }

  async searchWords(words: { text: string; alsoIds: string[] }[], { offset, limit }: { offset: number; limit: number }) {
    let query = this.db.from("member_directory").select("*");
    for (const w of words) {
      const clauses = ["name", "display_name", "bio"].map((f) => `${f}.ilike.${orPattern(w.text)}`);
      if (w.alsoIds.length > 0) clauses.push(`id.in.(${w.alsoIds.join(",")})`);
      query = query.or(clauses.join(","));
    }
    const { data, error } = await query.order("name").order("id").range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return data ?? [];
  }
}

/** In-memory twin over an `InMemoryDataset`: the directory is the dataset's members' public fields. */
export class InMemoryMemberDirectoryRepository implements MemberDirectoryRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private rows(): DirectoryRow[] {
    return this.data.members.map((m) => ({
      id: m.id,
      name: m.name,
      display_name: m.displayName ?? null,
      photo_url: m.photoUrl ?? null,
      bio: m.bio ?? null,
      instagram_url: m.instagramUrl ?? null,
      facebook_url: m.facebookUrl ?? null,
      twitter_url: m.twitterUrl ?? null,
      joined_at: m.joinedAt ?? "2026-01-01T00:00:00Z",
      first_joined_at: m.firstJoinedAt ?? null,
      most_recent_joined_at: m.mostRecentJoinedAt ?? null,
      total_active_months: m.totalActiveMonths ?? 0,
    }));
  }

  private byName(rows: DirectoryRow[]) {
    return [...rows].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
  }

  async byId(id: string) {
    return this.rows().find((m) => m.id === id) ?? null;
  }

  async byIds(ids: string[]) {
    const wanted = new Set(ids);
    return this.rows().filter((m) => wanted.has(m.id));
  }

  async all() {
    return this.byName(this.rows());
  }

  async matching(typed: string, limit: number) {
    const needle = typed.toLowerCase();
    return this.byName(this.rows().filter((m) => m.name.toLowerCase().includes(needle) || (m.display_name ?? "").toLowerCase().includes(needle))).slice(0, limit);
  }

  async idsMatching(typed: string, limit: number) {
    return (await this.matching(typed, limit)).map((m) => m.id);
  }

  async searchWords(words: { text: string; alsoIds: string[] }[], { offset, limit }: { offset: number; limit: number }) {
    const matches = (m: DirectoryRow, w: { text: string; alsoIds: string[] }) => {
      const needle = w.text.replace(/[\\%_,()"]/g, " ").trim().toLowerCase();
      return [m.name, m.display_name, m.bio].some((f) => (f ?? "").toLowerCase().includes(needle)) || w.alsoIds.includes(m.id);
    };
    return this.byName(this.rows().filter((m) => words.every((w) => matches(m, w)))).slice(offset, offset + limit);
  }
}
