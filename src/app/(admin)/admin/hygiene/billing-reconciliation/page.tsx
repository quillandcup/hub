import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/admin-auth";
import { getServiceRepos } from "@/lib/data/server";
import { loadBillingOverview } from "@/lib/billing-reconciliation-loader";
import BillingOverview from "./BillingOverview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Billing Reconciliation",
};

/**
 * Who has a billing row that needs a look: the Hub's expected billing days against what Stripe did. The detail
 * for one member is on their Transactions tab. Payment data is service role only, so the permission is
 * checked first and the read goes through the service repositories.
 */
export default async function BillingReconciliationPage() {
  await requirePermission("billing.reconciliation.read");
  const overview = await loadBillingOverview(getServiceRepos());

  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <Link href="/admin/hygiene" className="text-sm text-plum-600 hover:text-plum-700 dark:text-plum-400 dark:hover:text-plum-300">
            ← Data Hygiene Dashboard
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">Billing Reconciliation</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-8">
          Membership payments in Stripe against the days the Hub expects them (the subscription, minus hiatuses and programs that include
          membership), as of the last Stripe import. Open a member to see every billing day with its status.
        </p>
        <BillingOverview overview={overview} />
      </div>
    </div>
  );
}
