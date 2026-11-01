import { fetchAllRows } from "@/lib/supabase/paginate";
import { compareText, type Page } from "./query";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** A staff member (`staff`): the team, by email, with the hire date and role the members processing merges in. */
export type StaffRow = Row<"staff">;

/** The member a staff row is linked to (null: no member has that email). */
export type StaffMemberLink = { id: string; member_id: string | null };

/**
 * The staff table (`staff`): a small Local-layer table the members processing reads to give staff their role and hire
 * date, and keeps linked to the member with the same email. Every method throws on a database error.
 */
export interface StaffRepository {
  /** Every staff row, ordered by name then id. Paginated. */
  all(): Promise<StaffRow[]>;
  /** Points each staff row at its member (or at none). Rows run in parallel; throws the first failure after all have finished. */
  linkMembers(links: StaffMemberLink[]): Promise<void>;
}

const byNameThenId = (a: StaffRow, b: StaffRow) => compareText(a.name, b.name) || compareText(a.id, b.id);

export class SupabaseStaffRepository implements StaffRepository {
  constructor(private readonly db: Db) {}

  async all() {
    return fetchAllRows<StaffRow>(
      (from, to) => this.db.from("staff").select("*").order("name").order("id").range(from, to) as unknown as PromiseLike<Page<StaffRow>>,
    );
  }

  async linkMembers(links: StaffMemberLink[]) {
    const results = await Promise.all(links.map((l) => this.db.from("staff").update({ member_id: l.member_id }).eq("id", l.id)));
    const failed = results.find((r) => r.error);
    if (failed?.error) throw new Error(failed.error.message);
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryStaffRepository implements StaffRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async all() {
    return [...this.data.staff].sort(byNameThenId).map((s) => ({ ...s }));
  }

  async linkMembers(links: StaffMemberLink[]) {
    for (const link of links) {
      const row = this.data.staff.find((s) => s.id === link.id);
      if (row) row.member_id = link.member_id;
    }
  }
}
