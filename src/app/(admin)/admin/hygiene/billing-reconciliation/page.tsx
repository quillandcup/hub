import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/admin-auth";
import { getServiceRepos } from "@/lib/data/server";
import { loadAcknowledgements } from "@/lib/billing-acknowledgements-loader";
import { loadBillingOverview } from "@/lib/billing-reconciliation-loader";
import { can } from "@/lib/permissions";
import BillingOverview from "./BillingOverview";

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
export default async function BillingReconciliationPage({ searchParams }: { searchParams: Promise<{ filter?: string; hub?: string; ack?: string }> }) {
  const viewer = await requirePermission("billing.reconciliation.read");
  const { filter, hub, ack } = await searchParams;
  const repos = getServiceRepos();
  const [overview, { acks, staff }] = await Promise.all([loadBillingOverview(repos), loadAcknowledgements(repos)]);

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <Link href="/admin/hygiene" className="text-sm text-plum-600 hover:text-plum-700 dark:text-plum-400 dark:hover:text-plum-300">
            ← Data Hygiene Dashboard
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">Hiatus &amp; Billing Reconciliation</h1>
        <p className="max-w-4xl text-sm text-slate-600 dark:text-slate-400 mb-8">
          Membership payments in Stripe against the days the Hub expects them (the subscription, minus hiatuses and programs that include
          membership), as of the last Stripe import. Stripe says who is paused or cancelled today (a paused subscription with a resume date is a
          hiatus ending that day); past hiatuses come from the Hub&apos;s hiatus history. Each row is one thing to look at, with the money at stake and how long it has waited; the most urgent (members who are behind, then the largest and oldest) come first.
          Sort or search the table, pick a group of rows to work through, or narrow by the member&apos;s Hub status. Open a row to see the invoices behind it with links to Stripe, or open the member to see
          every billing day with its status. A pause of about one billing period reads as a possible gifted month, not a hiatus; two or more, or none ending, as a hiatus. That is a guess from the pause length. The Hub's hiatus records are also checked against the invoices: a run of billing periods with no payment (and no failed payment, cancellation or program to explain it) is an inferred pause, compared with the recorded hiatus. Also a guess.
        </p>
        <p className="max-w-4xl text-sm text-slate-600 dark:text-slate-400 mb-8">
          Events, programs and courses are lined up from Kajabi&apos;s purchases: each one against the Stripe payments Kajabi collected for it (found by
          the offer, the day and the amount). An event also checks the attendee list: someone who bought a ticket should have paid; a gifted, comped or
          transferred ticket expects no payment here; a payment from someone who is not attending needs a mark (forfeited or other), or a gifted or
          transferred ticket. A retreat can be paid in parts, so payments are listed, never totalled against a guessed price. Open a member and
          choose &ldquo;Group by product&rdquo; for the detail.
        </p>
        <p className="max-w-4xl text-sm text-slate-600 dark:text-slate-400 mb-8">
          Not every row is a problem: a purchase can be comped, a month gifted, a payment kept after a cancellation, or paid outside Stripe. Open a row and mark it with the reason.
          It leaves the count and the dollars at stake, stays on the page when you choose &ldquo;Show acknowledged&rdquo;, and comes back by itself if the row changes later.
        </p>
        <BillingOverview overview={overview} filter={filter} hub={hub} ack={ack} acknowledgements={acks} staff={staff} canAcknowledge={can(viewer, "billing.reconciliation.acknowledge")} />
      </div>
    </div>
  );
}
