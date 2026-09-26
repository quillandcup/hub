import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import ResubscriptionsChart from "./ResubscriptionsChart";
import { fetchResubscriptionsData } from "@/lib/resubscription-data";
import ResubscribingMembersTable from "./ResubscribingMembersTable";
import { requireAdminPage } from "@/lib/admin-auth";

export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Cancellations & Resubscriptions",
};

function pct(num: number, denom: number): string {
  if (denom === 0) return "—";
  return `${((num / denom) * 100).toFixed(1)}%`;
}

export default async function ResubscriptionsPage() {
  await requireAdminPage();
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const data = await fetchResubscriptionsData(supabase);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/admin" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            Cancellations &amp; Resubscriptions
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Members who cancelled and later rejoined — a signal of re-engagement over time.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-8">
        <>
            {/* Stat cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <StatCard
                value={data.totalResubscribingMembers}
                label="Members who resubscribed"
                sub="at least once after cancelling"
              />
              <StatCard
                value={pct(data.totalResubscribingMembers, data.totalActiveMembers)}
                label="of active members"
                sub={`out of ${data.totalActiveMembers} active members`}
                isText
              />
            </div>

            {/* Cohort chart */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6">
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-1">
                Resubscriptions by Month
              </h2>
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
                When former members rejoined. An upward trend suggests improving re-engagement.
              </p>
              <ResubscriptionsChart data={data.cohortByMonth} />
            </div>

            {/* Member table */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
                  Resubscribing Members
                </h2>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                  {data.members.length} member{data.members.length !== 1 ? "s" : ""} with at least one resubscription
                </p>
              </div>

              {data.members.length === 0 ? (
                <div className="p-12 text-center text-slate-400 dark:text-slate-500 text-sm">
                  No resubscriptions found yet.
                </div>
              ) : (
                <ResubscribingMembersTable members={data.members} />
              )}
            </div>
        </>
      </main>
    </div>
  );
}

function StatCard({
  value,
  label,
  sub,
  isText,
}: {
  value: number | string;
  label: string;
  sub?: string;
  isText?: boolean;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 text-center">
      <div className={`text-4xl font-bold text-blue-600 dark:text-blue-400 ${isText ? "" : "tabular-nums"}`}>{value}</div>
      <div className="text-sm font-medium text-slate-700 dark:text-slate-300 mt-1">{label}</div>
      {sub && <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}
