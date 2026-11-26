"use server";

import { revalidatePath } from "next/cache";
import { requireActionPermission } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { ackInputError, ackStillApplies, cleanNote, type AckReason } from "@/lib/billing-acknowledgements";
import { buildIssues } from "@/lib/billing-issues";
import { loadBillingOverview } from "@/lib/billing-reconciliation-loader";
import { AcknowledgementConflict } from "@/lib/data/billing-acknowledgements";
import { getRepos, getServiceRepos } from "@/lib/data/server";

export type AcknowledgeResult = { ok: true } | { ok: false; error: string };

const PAGE = "/admin/hygiene/billing-reconciliation";
const MAX_KEY = 300;

async function acknowledgeBillingRowImpl(userId: string, input: { rowKey: string; reason: AckReason; note?: string | null }): Promise<AcknowledgeResult> {
  const note = cleanNote(input?.note);
  const problem = ackInputError(input?.reason, note);
  if (problem) return { ok: false, error: problem };
  const rowKey = typeof input.rowKey === "string" ? input.rowKey.trim() : "";
  if (!rowKey || rowKey.length > MAX_KEY) return { ok: false, error: "Row not found." };

  try {
    const overview = await loadBillingOverview(getServiceRepos());
    const issue = buildIssues(overview).find((i) => i.key === rowKey);
    if (!issue) return { ok: false, error: "This row is not on the billing reconciliation page right now (it may be fixed, or older than the months that page covers), so there is nothing to mark. Reload and try again." };

    const mine = (await getRepos()).billingAcknowledgements;
    const existing = await mine.activeFor(rowKey);
    if (existing) {
      if (existing.reason === input.reason && existing.note === note && ackStillApplies(issue, existing)) return { ok: true };
      await mine.revoke(rowKey, userId);
    }
    await mine.add({
      rowKey,
      memberId: issue.memberId,
      purchaseType: issue.purchaseType,
      reason: input.reason,
      note,
      statusAtAck: issue.status,
      amountCentsAtAck: issue.amountCents,
      acknowledgedBy: userId,
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch (error) {
    if (error instanceof AcknowledgementConflict) return { ok: false, error: "Someone just marked this row. Reload the page." };
    console.error("[billing-acknowledge] failed:", error instanceof Error ? error.message : error);
    return { ok: false, error: "Couldn't save." };
  }
}

async function revokeBillingAcknowledgementImpl(userId: string, input: { rowKey: string }): Promise<AcknowledgeResult> {
  const rowKey = typeof input?.rowKey === "string" ? input.rowKey.trim() : "";
  if (!rowKey || rowKey.length > MAX_KEY) return { ok: false, error: "Row not found." };
  try {
    await (await getRepos()).billingAcknowledgements.revoke(rowKey, userId);
    revalidatePath(PAGE);
    return { ok: true };
  } catch (error) {
    console.error("[billing-acknowledge] revoke failed:", error instanceof Error ? error.message : error);
    return { ok: false, error: "Couldn't undo." };
  }
}

// Usage analytics: each action records whether it worked (src/lib/analytics/server.ts).
/**
 * Marks a billing reconciliation row as a decision staff made (gift, comp, forfeited, paid elsewhere, other). The row
 * must be one the overview lists as needing a look right now: it is recomputed here, and the status and the amount at
 * stake recorded are the server's, never the client's. The write goes through the signed-in person's own client, so the
 * audit log names them (the table is admin only by row-level security). Marking the same thing twice changes nothing;
 * marking a row whose earlier acknowledgement no longer applies (or with another reason) replaces it, the old one kept
 * as revoked. Docs: docs/architecture/BILLING_RECONCILIATION.md, "Acknowledging a row".
 */
export async function acknowledgeBillingRow(input: { rowKey: string; reason: AckReason; note?: string | null }): Promise<AcknowledgeResult> {
  const auth = await requireActionPermission("billing.reconciliation.acknowledge");
  if (!auth.ok) return { ok: false, error: auth.error };
  return withAction("billing_row_acknowledged", () => acknowledgeBillingRowImpl(auth.user.id, input));
}

/** Undoes the active acknowledgement of a row (who and when are kept as history). Nothing to undo is not an error. */
export async function revokeBillingAcknowledgement(input: { rowKey: string }): Promise<AcknowledgeResult> {
  const auth = await requireActionPermission("billing.reconciliation.acknowledge");
  if (!auth.ok) return { ok: false, error: auth.error };
  return withAction("billing_acknowledgement_revoked", () => revokeBillingAcknowledgementImpl(auth.user.id, input));
}
