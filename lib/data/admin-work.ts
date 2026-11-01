import { fetchAllRows } from "@/lib/supabase/paginate";
import { compareText } from "./query";
import type { Db, Insert, Row, Update } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** An admin's handling of one work-queue item (`admin_work_queue_completions`): done, opted out, or postponed. */
export type WorkQueueCompletionRow = Row<"admin_work_queue_completions">;
export type WorkQueueCompletion = Pick<WorkQueueCompletionRow, "queue_type" | "member_id" | "occurrence_key" | "status" | "postponed_until">;
export type NewWorkQueueCompletion = Pick<Insert<"admin_work_queue_completions">, "queue_type" | "member_id" | "occurrence_key" | "status" | "postponed_until" | "completed_by">;

/** A feedback submission (`feedback`) from a member's feedback widget. */
export type FeedbackRow = Row<"feedback">;
export type NewFeedback = Pick<Insert<"feedback">, "id" | "user_id" | "member_id" | "is_sudo" | "page_url" | "feedback_type" | "message" | "screenshot_path" | "user_agent">;
export type FeedbackPatch = Pick<Update<"feedback">, "status" | "admin_notes">;
/** A feedback row with the member who sent it (null when they are gone or it came from an admin without a member record). */
export type FeedbackWithMember = FeedbackRow & { member: { name: string; display_name: string | null; email: string } | null };
export type FeedbackPage = { rows: FeedbackWithMember[]; total: number };

const FEEDBACK_WITH_MEMBER = "*, member:members(name, display_name, email)";

/** PostgREST returns a to-one embed as an object, though callers have also met it as a one-item array. */
function one<T>(embed: T | T[] | null | undefined): T | null {
  return (Array.isArray(embed) ? embed[0] : embed) ?? null;
}

/**
 * What staff keep to run the community by hand: the work queue's completions, the duplicate-member groups they
 * dismissed, and the feedback members send in (`admin_work_queue_completions`, `dismissed_duplicate_groups`,
 * `feedback`). Local data, admin-only except submitting feedback. Every method throws on a database error;
 * scans are paginated.
 */
export interface AdminWorkQueueRepository {
  // --- work queue ---
  /** Every completion (what the queues are filtered by), ordered by id. Paginated. */
  completions(): Promise<WorkQueueCompletion[]>;
  /** Records (or re-records) an item as handled and returns the row. One row per queue type, member and occurrence. */
  complete(item: NewWorkQueueCompletion): Promise<WorkQueueCompletionRow>;
  /** Undoes a completion (nothing happens when there is none). */
  undoCompletion(id: string): Promise<void>;

  // --- duplicate groups ---
  /** The keys of the duplicate groups an admin dismissed. Paginated. */
  dismissedGroupKeys(): Promise<Set<string>>;
  /** Dismisses a group; dismissing one twice is fine. */
  dismissGroup(groupKey: string): Promise<void>;
  /** Brings a dismissed group back. */
  restoreGroup(groupKey: string): Promise<void>;

  // --- feedback ---
  /** One page of feedback (optionally one status), newest first, with the sender, and the total that match. `page` counts from 0. */
  feedbackPage(options: { status?: string; page: number; pageSize: number }): Promise<FeedbackPage>;
  /** Saves a submission and returns it. */
  addFeedback(feedback: NewFeedback): Promise<FeedbackRow>;
  /** Changes a submission's status or admin notes (nothing happens when there is none). */
  updateFeedback(id: string, patch: FeedbackPatch): Promise<void>;
}

export class SupabaseAdminWorkQueueRepository implements AdminWorkQueueRepository {
  constructor(private readonly db: Db) {}

  async completions() {
    return fetchAllRows<WorkQueueCompletion>(
      (from, to) =>
        this.db
          .from("admin_work_queue_completions")
          .select("queue_type, member_id, occurrence_key, status, postponed_until")
          .order("id")
          .range(from, to),
    );
  }

  async complete(item: NewWorkQueueCompletion) {
    const { data, error } = await this.db
      .from("admin_work_queue_completions")
      .upsert(item, { onConflict: "queue_type,member_id,occurrence_key" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async undoCompletion(id: string) {
    const { error } = await this.db.from("admin_work_queue_completions").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async dismissedGroupKeys() {
    const rows = await fetchAllRows<Pick<Row<"dismissed_duplicate_groups">, "group_key">>(
      (from, to) =>
        this.db.from("dismissed_duplicate_groups").select("group_key").order("group_key").range(from, to),
    );
    return new Set(rows.map((r) => r.group_key));
  }

  async dismissGroup(groupKey: string) {
    const { error } = await this.db.from("dismissed_duplicate_groups").insert({ group_key: groupKey });
    if (error && error.code !== "23505") throw new Error(error.message); // already dismissed
  }

  async restoreGroup(groupKey: string) {
    const { error } = await this.db.from("dismissed_duplicate_groups").delete().eq("group_key", groupKey);
    if (error) throw new Error(error.message);
  }

  async feedbackPage({ status, page, pageSize }: { status?: string; page: number; pageSize: number }) {
    let query = this.db
      .from("feedback")
      .select(FEEDBACK_WITH_MEMBER, { count: "exact" })
      .order("created_at", { ascending: false })
      .order("id")
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (status) query = query.eq("status", status);
    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    const rows = (data ?? []).map((r) => ({
      ...r,
      member: one(r.member),
    }));
    return { rows, total: count ?? rows.length };
  }

  async addFeedback(feedback: NewFeedback) {
    const { data, error } = await this.db.from("feedback").insert(feedback).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async updateFeedback(id: string, patch: FeedbackPatch) {
    const { error } = await this.db.from("feedback").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryAdminWorkQueueRepository implements AdminWorkQueueRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async completions() {
    return [...this.data.workQueueCompletions]
      .sort((a, b) => compareText(a.id, b.id))
      .map(({ queue_type, member_id, occurrence_key, status, postponed_until }) => ({ queue_type, member_id, occurrence_key, status, postponed_until }));
  }

  async complete(item: NewWorkQueueCompletion) {
    if (!this.data.members.some((m) => m.id === item.member_id)) throw new Error("violates foreign key constraint on member_id");
    const existing = this.data.workQueueCompletions.find(
      (c) => c.queue_type === item.queue_type && c.member_id === item.member_id && c.occurrence_key === item.occurrence_key,
    );
    const fields = { status: item.status ?? "completed", postponed_until: item.postponed_until ?? null, completed_by: item.completed_by ?? null, completed_at: new Date().toISOString() };
    if (existing) {
      Object.assign(existing, fields);
      return { ...existing };
    }
    const row: WorkQueueCompletionRow = { id: crypto.randomUUID(), queue_type: item.queue_type, member_id: item.member_id, occurrence_key: item.occurrence_key, ...fields };
    this.data.workQueueCompletions.push(row);
    return { ...row };
  }

  async undoCompletion(id: string) {
    this.data.workQueueCompletions = this.data.workQueueCompletions.filter((c) => c.id !== id);
  }

  async dismissedGroupKeys() {
    return new Set(this.data.dismissedDuplicateGroups.map((g) => g.group_key));
  }

  async dismissGroup(groupKey: string) {
    if (this.data.dismissedDuplicateGroups.some((g) => g.group_key === groupKey)) return;
    this.data.dismissedDuplicateGroups.push({ group_key: groupKey, dismissed_at: new Date().toISOString() });
  }

  async restoreGroup(groupKey: string) {
    this.data.dismissedDuplicateGroups = this.data.dismissedDuplicateGroups.filter((g) => g.group_key !== groupKey);
  }

  async feedbackPage({ status, page, pageSize }: { status?: string; page: number; pageSize: number }) {
    // Newest first; rows saved in the same millisecond keep the later one first (the database's timestamps do not tie).
    const matching = this.data.feedback
      .map((row, order) => ({ row, order }))
      .filter(({ row }) => !status || row.status === status)
      .sort((a, b) => compareText(b.row.created_at, a.row.created_at) || b.order - a.order)
      .map(({ row }) => row);
    const rows = matching.slice(page * pageSize, page * pageSize + pageSize).map((f) => {
      const m = f.member_id ? this.data.members.find((x) => x.id === f.member_id) : undefined;
      return { ...f, member: m ? { name: m.name, display_name: m.displayName ?? null, email: m.email ?? "" } : null };
    });
    return { rows, total: matching.length };
  }

  async addFeedback(feedback: NewFeedback) {
    const row: FeedbackRow = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      status: "new",
      admin_notes: null,
      is_sudo: false,
      member_id: null,
      screenshot_path: null,
      user_agent: null,
      user_id: null,
      ...feedback,
    };
    this.data.feedback.push(row);
    return { ...row };
  }

  async updateFeedback(id: string, patch: FeedbackPatch) {
    const row = this.data.feedback.find((f) => f.id === id);
    if (row) Object.assign(row, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
  }
}
