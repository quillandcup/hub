import { fetchAllRows } from "@/lib/supabase/paginate";
import { clock } from "@/lib/clock";
import { isAckReason, type AckReason } from "@/lib/billing-ack-reasons";
import type { AckRecord } from "@/lib/billing-acknowledgements";
import type { PurchaseType } from "@/lib/billing-reconciliation";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { compareText } from "./query";

/** What staff decide when they acknowledge a row; the repository fills in who and when from the caller. */
export interface NewAcknowledgement {
  rowKey: string;
  memberId: string;
  purchaseType: PurchaseType;
  reason: AckReason;
  note: string | null;
  statusAtAck: string;
  amountCentsAtAck: number | null;
  acknowledgedBy: string | null;
}

/** The row already has an active acknowledgement (one at a time per row key). */
export class AcknowledgementConflict extends Error {}

/**
 * Acknowledgements of billing reconciliation rows (`billing_acknowledgements`, docs/architecture/BILLING_RECONCILIATION.md,
 * "Acknowledging a row"): why staff say a row is as it is, bound to the status and amount they saw. Local data, admin only
 * (row-level security): the server's service role reads them for the overview, an admin's own client writes, so the audit
 * log names the person. Revoked, never deleted: a revoke sets `revoked_at` and `revoked_by`, and marking again is a new row.
 * Every method throws on a database error.
 */
export interface BillingAcknowledgementRepository {
  /** Every active acknowledgement, ordered by row key. Paginated. */
  active(): Promise<AckRecord[]>;
  /** The active acknowledgement of one row, or null. */
  activeFor(rowKey: string): Promise<AckRecord | null>;
  /** Records a decision. Throws `AcknowledgementConflict` when the row already has an active one. */
  add(input: NewAcknowledgement): Promise<void>;
  /** Revokes the row's active acknowledgement as `revokedBy`. Returns whether there was one to revoke. */
  revoke(rowKey: string, revokedBy: string): Promise<boolean>;
}

type AckRow = Row<"billing_acknowledgements">;

function toRecord(row: AckRow): AckRecord {
  return {
    rowKey: row.row_key,
    memberId: row.member_id,
    // The check constraints hold these to the sets below.
    purchaseType: row.purchase_type as PurchaseType,
    reason: isAckReason(row.reason) ? row.reason : "other",
    note: row.note,
    statusAtAck: row.status_at_ack,
    amountCentsAtAck: row.amount_cents_at_ack,
    acknowledgedBy: row.acknowledged_by,
    acknowledgedAt: row.acknowledged_at,
    revokedBy: row.revoked_by,
    revokedAt: row.revoked_at,
  };
}

export class SupabaseBillingAcknowledgementRepository implements BillingAcknowledgementRepository {
  constructor(private readonly db: Db) {}

  async active() {
    const rows = await fetchAllRows<AckRow>((from, to) => this.db.from("billing_acknowledgements").select("*").is("revoked_at", null).order("row_key").order("id").range(from, to));
    return rows.map(toRecord);
  }

  async activeFor(rowKey: string) {
    const { data, error } = await this.db.from("billing_acknowledgements").select("*").eq("row_key", rowKey).is("revoked_at", null).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toRecord(data) : null;
  }

  async add(input: NewAcknowledgement) {
    const { error } = await this.db.from("billing_acknowledgements").insert({
      row_key: input.rowKey,
      member_id: input.memberId,
      purchase_type: input.purchaseType,
      reason: input.reason,
      note: input.note,
      status_at_ack: input.statusAtAck,
      amount_cents_at_ack: input.amountCentsAtAck,
      acknowledged_by: input.acknowledgedBy,
    });
    // 23505: the partial unique index on the active row key.
    if (error?.code === "23505") throw new AcknowledgementConflict(error.message);
    if (error) throw new Error(error.message);
  }

  async revoke(rowKey: string, revokedBy: string) {
    const { data, error } = await this.db
      .from("billing_acknowledgements")
      .update({ revoked_at: new Date(clock.now()).toISOString(), revoked_by: revokedBy })
      .eq("row_key", rowKey)
      .is("revoked_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  }
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryBillingAcknowledgementRepository implements BillingAcknowledgementRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private activeRows() {
    return this.data.billingAcknowledgements.filter((r) => !r.revoked_at);
  }

  async active() {
    return this.activeRows()
      .sort((a, b) => compareText(a.row_key, b.row_key) || compareText(a.id, b.id))
      .map(toRecord);
  }

  async activeFor(rowKey: string) {
    const row = this.activeRows().find((r) => r.row_key === rowKey);
    return row ? toRecord(row) : null;
  }

  async add(input: NewAcknowledgement) {
    if (!this.data.members.some((m) => m.id === input.memberId)) throw new Error('insert or update on table "billing_acknowledgements" violates foreign key constraint "billing_acknowledgements_member_id_fkey"');
    if (this.activeRows().some((r) => r.row_key === input.rowKey)) throw new AcknowledgementConflict('duplicate key value violates unique constraint "billing_acknowledgements_one_active"');
    if (input.reason === "other" && !input.note?.trim()) throw new Error('new row for relation "billing_acknowledgements" violates check constraint "billing_acknowledgements_other_needs_note"');
    this.data.billingAcknowledgements.push({
      id: `brak_${String(this.data.billingAcknowledgements.length + 1).padStart(12, "A")}`,
      row_key: input.rowKey,
      member_id: input.memberId,
      purchase_type: input.purchaseType,
      reason: input.reason,
      note: input.note,
      status_at_ack: input.statusAtAck,
      amount_cents_at_ack: input.amountCentsAtAck,
      acknowledged_by: input.acknowledgedBy,
      acknowledged_at: new Date(clock.now()).toISOString(),
      revoked_by: null,
      revoked_at: null,
    });
  }

  async revoke(rowKey: string, revokedBy: string) {
    const row = this.activeRows().find((r) => r.row_key === rowKey);
    if (!row) return false;
    row.revoked_at = new Date(clock.now()).toISOString();
    row.revoked_by = revokedBy;
    return true;
  }
}
