import Link from "next/link";
import { ROW_STATUSES, ROW_STATUS_LABELS, summarize } from "@/lib/billing-reconciliation";
import type { BillingOverview as Overview } from "@/lib/billing-reconciliation-loader";
import { getMemberDisplayName } from "@/lib/member-display-name";

/** The summary and the members with at least one row that needs a look, each linking to their Transactions tab. */
export default function BillingOverview({ overview }: { overview: Overview }) {
  const total = summarize(overview.schedules);
  const problems = overview.schedules
    .map((schedule) => ({ schedule, rows: schedule.rows.filter((r) => r.needsAttention) }))
    .filter((p) => p.rows.length > 0)
    .map((p) => ({ ...p, member: overview.members.get(p.schedule.memberId) }))
    .sort((a, b) => b.rows.length - a.rows.length || (a.member?.name ?? "").localeCompare(b.member?.name ?? ""));

  if (overview.counts.invoices === 0) {
    return <p className="text-sm text-slate-600 dark:text-slate-400">No Stripe invoices are imported yet, so there is nothing to line up.</p>;
  }

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-slate-900 rounded-lg shadow border border-slate-200 dark:border-slate-800 p-6">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Summary</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
          {overview.counts.linkedMembers} members with a Stripe customer, {overview.counts.invoices} invoices, as of {overview.today}.
        </p>
        <ul className="flex flex-wrap gap-3 text-sm">
          {ROW_STATUSES.map((s) => (
            <li key={s}>
              {ROW_STATUS_LABELS[s]}: <strong>{total.byStatus[s]}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white dark:bg-slate-900 rounded-lg shadow border border-slate-200 dark:border-slate-800">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Members who need a look</h2>
          <span className={`text-2xl font-bold ${problems.length > 0 ? "text-orange-500" : "text-green-500"}`}>{problems.length}</span>
        </div>
        {problems.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-green-700 dark:text-green-400 font-medium">Every billing day lines up.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400">
                <th className="px-6 py-3">Member</th>
                <th className="px-6 py-3">What is wrong</th>
              </tr>
            </thead>
            <tbody>
              {problems.map(({ schedule, rows, member }) => {
                const counts = ROW_STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length] as const).filter(([, n]) => n > 0);
                return (
                  <tr key={schedule.memberId} className="border-t border-slate-200 dark:border-slate-800 align-top">
                    <td className="px-6 py-3">
                      <Link href={`/admin/members/${schedule.memberId}/transactions`} className="text-plum-600 hover:text-plum-700 dark:text-plum-400 dark:hover:text-plum-300 hover:underline">
                        {member ? getMemberDisplayName({ name: member.name, display_name: member.displayName }) : schedule.memberId}
                      </Link>
                    </td>
                    <td className="px-6 py-3">{counts.map(([s, n]) => `${ROW_STATUS_LABELS[s]}: ${n}`).join(", ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
