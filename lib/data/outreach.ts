import { fetchAllRows } from "@/lib/supabase/paginate";
import { compareText, inChunks, type Page } from "./query";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** Ids per `.in(...)` filter, so the request URL stays under the length limit even with long ids. */
const ID_CHUNK_SIZE = 100;

/** How warm an outreach lead is (`outreach_leads`): one row per member the team has rated; members without one are "cold". */
export type OutreachLeadRow = Row<"outreach_leads">;
export type OutreachLeadStatus = Pick<OutreachLeadRow, "member_id" | "status" | "updated_at">;
/** One time the team reached out to a member (`outreach_touches`), append-only. */
export type OutreachTouchRow = Row<"outreach_touches">;

/**
 * Outreach to people who are not (or are no longer) members: the temperature of each lead and the log of touches
 * (`outreach_leads`, `outreach_touches`). Local data, admin-only. The Instagram prospects have their own
 * repository (`ProspectRepository`). Every method throws on a database error; scans are paginated.
 */
export interface OutreachRepository {
  /** The rated leads, ordered by member. Paginated. */
  leadStatuses(): Promise<OutreachLeadStatus[]>;
  /** Rates a member's lead (creating it) and returns it. `updatedBy` is the admin's user id, null for a system caller. */
  setLeadStatus(memberId: string, status: string, updatedBy: string | null): Promise<OutreachLeadRow>;
  /** Logs a touch and returns it. */
  logTouch(memberId: string, touchedBy: string | null): Promise<OutreachTouchRow>;
  /** When each of these members was last touched (members never touched are absent). Ids are chunked; touches paginated. */
  lastTouchByMember(memberIds: string[]): Promise<Map<string, string>>;
  /** When every touch since this instant happened (any member), oldest first. Paginated. */
  touchTimesSince(since: string): Promise<string[]>;
}

export class SupabaseOutreachRepository implements OutreachRepository {
  constructor(private readonly db: Db) {}

  async leadStatuses() {
    return fetchAllRows<OutreachLeadStatus>(
      (from, to) => this.db.from("outreach_leads").select("member_id, status, updated_at").order("member_id").range(from, to) as unknown as PromiseLike<Page<OutreachLeadStatus>>,
    );
  }

  async setLeadStatus(memberId: string, status: string, updatedBy: string | null) {
    const { data, error } = await this.db
      .from("outreach_leads")
      .upsert({ member_id: memberId, status, updated_by: updatedBy }, { onConflict: "member_id" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async logTouch(memberId: string, touchedBy: string | null) {
    const { data, error } = await this.db.from("outreach_touches").insert({ member_id: memberId, touched_by: touchedBy }).select("*").single();
    if (error) throw new Error(error.message);
    return data;
  }

  async lastTouchByMember(memberIds: string[]) {
    const rows = await inChunks(memberIds, ID_CHUNK_SIZE, (ids) =>
      fetchAllRows<Pick<OutreachTouchRow, "member_id" | "touched_at">>(
        (from, to) =>
          this.db.from("outreach_touches").select("member_id, touched_at").in("member_id", ids).order("id").range(from, to) as unknown as PromiseLike<Page<Pick<OutreachTouchRow, "member_id" | "touched_at">>>,
      ),
    );
    const last = new Map<string, string>();
    for (const r of rows) {
      const seen = last.get(r.member_id);
      if (!seen || r.touched_at > seen) last.set(r.member_id, r.touched_at);
    }
    return last;
  }

  async touchTimesSince(since: string) {
    const rows = await fetchAllRows<Pick<OutreachTouchRow, "touched_at">>(
      (from, to) =>
        this.db.from("outreach_touches").select("touched_at").gte("touched_at", since).order("touched_at").order("id").range(from, to) as unknown as PromiseLike<Page<Pick<OutreachTouchRow, "touched_at">>>,
    );
    return rows.map((r) => r.touched_at);
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryOutreachRepository implements OutreachRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private requireMember(id: string) {
    if (!this.data.members.some((m) => m.id === id)) throw new Error("violates foreign key constraint on member_id");
  }

  async leadStatuses() {
    return [...this.data.outreachLeads].sort((a, b) => compareText(a.member_id, b.member_id)).map(({ member_id, status, updated_at }) => ({ member_id, status, updated_at }));
  }

  async setLeadStatus(memberId: string, status: string, updatedBy: string | null) {
    this.requireMember(memberId);
    const now = new Date().toISOString();
    const existing = this.data.outreachLeads.find((l) => l.member_id === memberId);
    if (existing) {
      Object.assign(existing, { status, updated_by: updatedBy, updated_at: now });
      return { ...existing };
    }
    const row: OutreachLeadRow = { member_id: memberId, status, updated_by: updatedBy, created_at: now, updated_at: now };
    this.data.outreachLeads.push(row);
    return { ...row };
  }

  async logTouch(memberId: string, touchedBy: string | null) {
    this.requireMember(memberId);
    const row: OutreachTouchRow = { id: crypto.randomUUID(), member_id: memberId, touched_by: touchedBy, touched_at: new Date().toISOString() };
    this.data.outreachTouches.push(row);
    return { ...row };
  }

  async lastTouchByMember(memberIds: string[]) {
    const wanted = new Set(memberIds);
    const last = new Map<string, string>();
    for (const t of this.data.outreachTouches) {
      if (!wanted.has(t.member_id)) continue;
      const seen = last.get(t.member_id);
      if (!seen || t.touched_at > seen) last.set(t.member_id, t.touched_at);
    }
    return last;
  }

  async touchTimesSince(since: string) {
    return this.data.outreachTouches
      .filter((t) => t.touched_at >= since)
      .map((t) => t.touched_at)
      .sort(compareText);
  }
}
