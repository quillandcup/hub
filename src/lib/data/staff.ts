import { fetchAllRows } from "@/lib/supabase/paginate";
import { compareText } from "./query";
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
  /**
   * The ids of the members who are staff: THE definition, used wherever the question is asked (Hedgie Care leaves them out of
   * the DMs it offers). A member linked in the `staff` roster, or the member behind an admin, assistant or community manager
   * account (`user_profiles.role`). Who may READ something is a separate question, decided by role where it is asked. Service role in the database (the function behind it, `staff_member_ids`, refuses a
   * signed-in user); the staff list is a handful of people, so it is read in one call.
   */
  memberIds(): Promise<Set<string>>;
}

/** The roles of the accounts whose members are staff: the in-memory twin's copy of `staff_member_ids()`; the contract suite keeps them equal. */
const STAFF_ACCOUNT_ROLES = ["admin", "assistant", "community_manager"];

const byNameThenId = (a: StaffRow, b: StaffRow) => compareText(a.name, b.name) || compareText(a.id, b.id);

export class SupabaseStaffRepository implements StaffRepository {
  constructor(private readonly db: Db) {}

  async all() {
    return fetchAllRows<StaffRow>(
      (from, to) => this.db.from("staff").select("*").order("name").order("id").range(from, to),
    );
  }

  async linkMembers(links: StaffMemberLink[]) {
    const results = await Promise.all(links.map((l) => this.db.from("staff").update({ member_id: l.member_id }).eq("id", l.id)));
    const failed = results.find((r) => r.error);
    if (failed?.error) throw new Error(failed.error.message);
  }

  async memberIds() {
    const { data, error } = await this.db.rpc("staff_member_ids");
    if (error) throw new Error(error.message);
    return new Set(data ?? []);
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

  async memberIds() {
    return staffMemberIdsOf(this.data);
  }
}

/** The staff members of a dataset (the twin of `staff_member_ids()`), for the twins that need to ask the same question. */
export function staffMemberIdsOf(data: Pick<InMemoryDataset, "staff" | "userProfiles" | "members">): Set<string> {
  const ids = new Set(data.staff.map((s) => s.member_id).filter((id): id is string => !!id));
  const staffAccounts = new Set(data.userProfiles.filter((p) => STAFF_ACCOUNT_ROLES.includes(p.role ?? "member")).map((p) => p.id));
  for (const m of data.members) if (m.userId && staffAccounts.has(m.userId)) ids.add(m.id);
  return ids;
}
