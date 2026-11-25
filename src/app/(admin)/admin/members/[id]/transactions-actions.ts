"use server";

import { requireActionPermission } from "@/lib/admin-auth";
import { getRepos, getServiceRepos } from "@/lib/data/server";
import { isId } from "@/lib/ids";
import type { PurchaseSchedule } from "@/lib/billing-reconciliation";
import { loadMemberSchedules } from "@/lib/billing-reconciliation-loader";
import { buildTransactions, stripeLookupEmails, type TransactionRow } from "@/lib/member-transactions";

export type TransactionsResult = { error: string } | { rows: TransactionRow[]; customerCount: number; schedules: PurchaseSchedule[] };

/**
 * A member's Stripe invoices and payments, read when their Transactions tab opens (every other tab's data is
 * loaded with the page, but this one is only wanted by staff who ask for it). Bronze billing is service-role only,
 * so the permission is checked here first. Customers are found by the linked id plus every email the member has
 * (primary and aliases), because a checkout can create a second customer under an old address.
 * TODO(docs/TODO.md: "Support several Stripe customers per member"): read the link table once it exists.
 */
export async function loadMemberTransactions(memberId: string): Promise<TransactionsResult> {
  const auth = await requireActionPermission("member.transactions_tab");
  if (!auth.ok) return { error: auth.error };
  if (!isId(memberId, "mbr")) return { error: "Member not found." };
  try {
    const repos = await getRepos();
    const [member, aliases] = await Promise.all([repos.members.adminView(memberId), repos.aliases.emailsOf(memberId)]);
    if (!member) return { error: "Member not found." };

    const billing = getServiceRepos().billing;
    const byEmail = await billing.stripeCustomers({ emails: stripeLookupEmails([member.email, ...aliases.map((a) => a.alias_email)]) });
    const customerIds = [...new Set([member.stripeCustomerId, ...byEmail.map((c) => c.stripe_customer_id)].filter((c): c is string => !!c))];
    if (customerIds.length === 0) return { rows: [], customerCount: 0, schedules: [] };

    const [invoices, charges] = await Promise.all([billing.stripeInvoices({ customerIds }), billing.stripeCharges({ customerIds })]);
    const productIds = [...new Set(invoices.map((i) => i.stripe_product_id).filter((p): p is string => !!p))];
    const products = await billing.stripeProductsByIds(productIds);
    const names = new Map(products.map((p) => [p.stripe_product_id, p.name]));
    const schedules = await loadMemberSchedules(getServiceRepos(), { id: member.id, status: member.status }, customerIds, invoices, charges);
    return { rows: buildTransactions(invoices, charges, names), customerCount: customerIds.length, schedules };
  } catch (error) {
    console.error("[member-transactions] load failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't load the transactions." };
  }
}
