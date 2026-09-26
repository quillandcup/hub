import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import type { Metadata } from "next";
import MissingStripeTable from "./MissingStripeTable";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Missing Member Data",
};

export default async function MissingMemberDataPage() {
  const supabase = await createClient();

  const { data: missingStripe } = await supabase
    .from("members")
    .select("id, name, email, kajabi_id")
    .eq("status", "active")
    .is("stripe_customer_id", null)
    .order("name");

  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <Link
            href="/admin/hygiene"
            className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            ← Data Hygiene Dashboard
          </Link>
        </div>

        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
          Missing Member Data
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">
          Active members with incomplete external account linkage.
        </p>

        <div className="space-y-8">
          {/* Missing Stripe ID */}
          <section className="bg-white dark:bg-slate-900 rounded-lg shadow border border-slate-200 dark:border-slate-800">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Missing Stripe Customer ID
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  Active members with no match in{" "}
                  <code className="text-xs bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">
                    bronze.stripe_customers
                  </code>
                  . Re-run{" "}
                  <code className="text-xs bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">
                    /api/process/members
                  </code>{" "}
                  after importing fresh Stripe data to resolve matched members.
                </p>
              </div>
              <span className={`text-2xl font-bold ${(missingStripe?.length ?? 0) > 0 ? "text-orange-500" : "text-green-500"}`}>
                {missingStripe?.length ?? 0}
              </span>
            </div>
            {missingStripe && missingStripe.length > 0 ? (
              <MissingStripeTable rows={missingStripe} />
            ) : (
              <div className="px-6 py-8 text-center text-sm text-green-600 dark:text-green-400 font-medium">
                All active members have a Stripe customer ID.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
