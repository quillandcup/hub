import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/admin-auth";
import { getServiceRepos } from "@/lib/data/server";
import { loadBillingOverview } from "@/lib/billing-reconciliation-loader";
import BillingOverview, { parseProblemFilter } from "./BillingOverview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hiatus & Billing Reconciliation",
};

/**
 * Who has a billing row that needs a look: the Hub's expected billing days against what Stripe did, and where
 * the Hub's hiatus or cancelled status disagrees with the Stripe subscription. The detail for one member is on
 * their Transactions tab. Payment data is service role only, so the permission is checked first and the read
 * goes through the service repositories.
 */
export default async function BillingReconciliationPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requirePermission("billing.reconciliation.read");
  const { filter } = await searchParams;
  const overview = await loadBillingOverview(getServiceRepos());

  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <Link href="/admin/hygiene" className="text-sm text-plum-600 hover:text-plum-700 dark:text-plum-400 dark:hover:text-plum-300">
            ← Data Hygiene Dashboard
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">Hiatus &amp; Billing Reconciliation</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-8">
          Membership payments in Stripe against the days the Hub expects them (the subscription, minus hiatuses and programs that include
          membership), as of the last Stripe import. Stripe says who is paused or cancelled today (a paused subscription with a resume date is a
          hiatus ending that day); past hiatuses come from the Hub&apos;s hiatus history. Use the filters for charges during a hiatus, a member who was
          not billed after a hiatus ended (including one that ended on the billing day), and where the Hub and Stripe disagree. Open a member to see
          every billing day with its status. A pause of about one billing period reads as a possible gifted month, not a hiatus; two or more, or none ending, as a hiatus. That is a guess from the pause length. The Hub's hiatus records are also checked against the invoices: a run of billing periods with no payment (and no failed payment, cancellation or program to explain it) is an inferred pause, compared with the recorded hiatus. Also a guess.
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-8">
          Events, programs and courses are lined up from Kajabi&apos;s purchases: each one against the Stripe payments Kajabi collected for it (found by
          the offer, the day and the amount). An event also checks the attendee list: someone who bought a ticket should have paid; a gifted, comped or
          transferred ticket expects no payment here; a payment from someone who is not attending needs a mark (forfeited or other), or a gifted or
          transferred ticket. A retreat can be paid in parts, so payments are listed, never totalled against a guessed price. Open a member and
          choose &ldquo;Group by product&rdquo; for the detail.
        </p>
        <BillingOverview overview={overview} filter={parseProblemFilter(filter)} />
      </div>
    </div>
  );
}
