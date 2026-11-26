import { ACK_NOTE_MAX, ACK_REASON_LABELS, isAckReason, type AckReason } from "@/lib/billing-ack-reasons";
import { easternDay, type PurchaseType } from "@/lib/billing-reconciliation";

/**
 * Acknowledgements of billing reconciliation rows: staff record WHY a row is as it is (a purchase that was comped, a
 * month gifted, a payment kept after a cancellation, a payment made outside Stripe), and the row leaves the to-do count
 * while the decision stays visible and reversible. Pure: the table, the repository and the actions are elsewhere; this
 * is the vocabulary and the rule for when an acknowledgement still applies. Docs: docs/architecture/BILLING_RECONCILIATION.md,
 * "Acknowledging a row".
 */

export * from "@/lib/billing-ack-reasons";

/** An acknowledgement as the repository stores it (no ids: nothing here is shown or linked by id). */
export interface AckRecord {
  rowKey: string;
  memberId: string;
  purchaseType: PurchaseType;
  reason: AckReason;
  note: string | null;
  /** The row's status when staff marked it. */
  statusAtAck: string;
  /** What was at stake when staff marked it, in cents; null when none was known. */
  amountCentsAtAck: number | null;
  /** Who marked it: the auth user id (for looking the person up), or null. */
  acknowledgedBy: string | null;
  acknowledgedAt: string;
  revokedBy: string | null;
  revokedAt: string | null;
}

/** The part of a row an acknowledgement is bound to. */
export interface AckSubject {
  key: string;
  status: string;
  amountCents: number | null;
}

/**
 * An acknowledgement as shown: serializable, with who marked it as a label. `state` says whether it still applies
 * to the row as it is now (`applies`), or the row has changed since (a payment arrived, the amount grew: `changed`),
 * in which case the row is back on the to-do list and says so.
 */
export interface AckView {
  reason: AckReason;
  note: string | null;
  /** Who marked it (their sign-in email), or null when unknown. */
  by: string | null;
  /** The Eastern day it was marked, YYYY-MM-DD. */
  day: string;
  statusAtAck: string;
  amountCentsAtAck: number | null;
  state: "applies" | "changed";
}

/** Whether what staff saw is still what the row is: the same status and the same amount at stake. */
export const ackStillApplies = (subject: Pick<AckSubject, "status" | "amountCents">, record: Pick<AckRecord, "statusAtAck" | "amountCentsAtAck">): boolean =>
  subject.status === record.statusAtAck && (subject.amountCents ?? null) === (record.amountCentsAtAck ?? null);

/** The acknowledgement of one row as it should be shown now, or null when it was never marked. */
export function ackViewFor(subject: AckSubject, record: AckRecord | undefined, byLabel: ReadonlyMap<string, string> = new Map()): AckView | null {
  if (!record || record.revokedAt) return null;
  return {
    reason: record.reason,
    note: record.note,
    by: record.acknowledgedBy ? (byLabel.get(record.acknowledgedBy) ?? null) : null,
    day: easternDay(record.acknowledgedAt),
    statusAtAck: record.statusAtAck,
    amountCentsAtAck: record.amountCentsAtAck,
    state: ackStillApplies(subject, record) ? "applies" : "changed",
  };
}

/** True when the row is acknowledged and nothing has changed since: it is off the to-do list. */
export const isAcknowledged = (ack: Pick<AckView, "state"> | null | undefined): boolean => ack?.state === "applies";

/** The active records by row key (a revoked one is history and never applies). */
export function activeByKey(records: readonly AckRecord[]): Map<string, AckRecord> {
  return new Map(records.filter((r) => !r.revokedAt).map((r) => [r.rowKey, r]));
}

/** What staff typed, trimmed to what is stored; null when empty. */
export const cleanNote = (note: string | null | undefined): string | null => note?.trim() || null;

/** Why an acknowledgement cannot be made as asked, or null when it can. */
export function ackInputError(reason: unknown, note: string | null): string | null {
  if (!isAckReason(reason)) return "Choose a reason.";
  if (note && note.length > ACK_NOTE_MAX) return `Keep the note to ${ACK_NOTE_MAX} characters.`;
  if (reason === "other" && !note) return "Add a note saying what this is.";
  return null;
}

/** "was marked comp on 2026-11-27, but it has changed since" for the row that came back. */
export const changedSinceText = (ack: Pick<AckView, "reason" | "day">): string =>
  `Was marked ${ACK_REASON_LABELS[ack.reason].toLowerCase()} on ${ack.day}, but it has changed since.`;
