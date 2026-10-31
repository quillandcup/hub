import { byKeyThenId } from "./query";
import type { Db, Insert, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** An award a member recorded for a piece of work (`member_awards`). Removing one is a soft delete (`deleted_at`). */
export type AwardRow = Row<"member_awards">;
/** What a member's awards list shows. */
export type Award = Pick<AwardRow, "id" | "award_name" | "category" | "work_title" | "book_id" | "project_id" | "award_date" | "url" | "notes">;
/** The fields a member types for an award. */
export type NewAward = Pick<Insert<"member_awards">, "member_id" | "award_name" | "work_title" | "award_date"> &
  Partial<Pick<Insert<"member_awards">, "category" | "book_id" | "project_id" | "url" | "notes">>;
export type AwardFields = Omit<NewAward, "member_id">;

/** Which awards a search finds; all given conditions must hold. */
export type AwardSearch = {
  /** Each word must appear, in any case, in the award name, category or work title. */
  words: string[];
  /** Only awards of these members (at most a few dozen; an empty list matches nothing). */
  memberIds?: string[] | null;
  /** Dates (YYYY-MM-DD, or an ISO instant of which the date is used): award date at or after / before. */
  after?: string;
  before?: string;
  limit: number;
  offset: number;
};
export type AwardHit = Pick<AwardRow, "id" | "award_name" | "category" | "work_title" | "award_date">;

const AWARD_COLUMNS = "id, award_name, category, work_title, book_id, project_id, award_date, url, notes";
const SEARCH_FIELDS = ["award_name", "category", "work_title"] as const;

/** A search word with the characters that mean something to LIKE or to a PostgREST filter neutralized. */
const searchWord = (word: string) => word.replace(/[\\%_,()"]/g, " ").trim();

/**
 * Members' awards (`member_awards`). Rows are the member's own under RLS (an admin sees all); only live awards
 * (`deleted_at` null) are read or changed. Every method throws on a database error.
 */
export interface AwardRepository {
  /** A member's awards, latest award date first. */
  ofMember(memberId: string): Promise<Award[]>;
  /** Records an award. */
  add(award: NewAward): Promise<void>;
  /** Replaces an award's fields. False when no live award has that id (or it is not the caller's). */
  update(id: string, fields: AwardFields): Promise<boolean>;
  /** Soft-deletes an award: the row stays until the member asks for its removal. False when no live award has that id. */
  remove(id: string): Promise<boolean>;
  /** Awards matching the search, latest award date first (then id), one page. */
  search(query: AwardSearch): Promise<AwardHit[]>;
}

export class SupabaseAwardRepository implements AwardRepository {
  constructor(private readonly db: Db) {}

  async ofMember(memberId: string) {
    const { data, error } = await this.db
      .from("member_awards")
      .select(AWARD_COLUMNS)
      .eq("member_id", memberId)
      .is("deleted_at", null)
      .order("award_date", { ascending: false })
      .order("id");
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async add(award: NewAward) {
    const { error } = await this.db.from("member_awards").insert(award);
    if (error) throw new Error(error.message);
  }

  async update(id: string, fields: AwardFields) {
    const { data, error } = await this.db.from("member_awards").update(fields).eq("id", id).is("deleted_at", null).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    return data !== null;
  }

  async remove(id: string) {
    const { data, error } = await this.db
      .from("member_awards")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data !== null;
  }

  async search(q: AwardSearch) {
    if (q.memberIds && q.memberIds.length === 0) return [];
    let query = this.db.from("member_awards").select("id, award_name, category, work_title, award_date");
    for (const word of q.words) {
      query = query.or(SEARCH_FIELDS.map((f) => `${f}.ilike."%${searchWord(word)}%"`).join(","));
    }
    query = query.is("deleted_at", null);
    if (q.memberIds) query = query.in("member_id", q.memberIds);
    if (q.after) query = query.gte("award_date", q.after.slice(0, 10));
    if (q.before) query = query.lt("award_date", q.before.slice(0, 10));
    const { data, error } = await query.order("award_date", { ascending: false }).order("id").range(q.offset, q.offset + q.limit - 1);
    if (error) throw new Error(error.message);
    return data ?? [];
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryAwardRepository implements AwardRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private live() {
    return this.data.awards.filter((a) => a.deleted_at === null);
  }

  async ofMember(memberId: string) {
    return this.live()
      .filter((a) => a.member_id === memberId)
      .sort(byKeyThenId<AwardRow>((a) => a.award_date, (a) => a.id, true))
      .map(({ id, award_name, category, work_title, book_id, project_id, award_date, url, notes }) => ({ id, award_name, category, work_title, book_id, project_id, award_date, url, notes }));
  }

  async add(award: NewAward) {
    if (!this.data.members.some((m) => m.id === award.member_id)) throw new Error("violates foreign key constraint on member_id");
    this.data.awards.push({
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      deleted_at: null,
      category: null,
      book_id: null,
      project_id: null,
      url: null,
      notes: null,
      ...award,
    });
  }

  async update(id: string, fields: AwardFields) {
    const row = this.live().find((a) => a.id === id);
    if (!row) return false;
    Object.assign(row, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)));
    return true;
  }

  async remove(id: string) {
    const row = this.live().find((a) => a.id === id);
    if (!row) return false;
    row.deleted_at = new Date().toISOString();
    return true;
  }

  async search(q: AwardSearch) {
    if (q.memberIds && q.memberIds.length === 0) return [];
    const words = q.words.map((w) => searchWord(w).toLowerCase());
    return this.live()
      .filter((a) => {
        if (q.memberIds && !q.memberIds.includes(a.member_id)) return false;
        if (q.after && a.award_date < q.after.slice(0, 10)) return false;
        if (q.before && a.award_date >= q.before.slice(0, 10)) return false;
        return words.every((w) => SEARCH_FIELDS.some((f) => (a[f] ?? "").toLowerCase().includes(w)));
      })
      .sort(byKeyThenId<AwardRow>((a) => a.award_date, (a) => a.id, true))
      .slice(q.offset, q.offset + q.limit)
      .map(({ id, award_name, category, work_title, award_date }) => ({ id, award_name, category, work_title, award_date }));
  }
}
