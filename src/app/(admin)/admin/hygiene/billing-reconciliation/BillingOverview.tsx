import Link from "next/link";
import { ROW_STATUSES, ROW_STATUS_LABELS, summarize, type ScheduleRow } from "@/lib/billing-reconciliation";
import type { BillingOverview as Overview } from "@/lib/billing-reconciliation-loader";
import { getMemberDisplayName } from "@/lib/member-display-name";

const isBehind = (r: ScheduleRow) => r.status === "unpaid_behind";

/** The ways to narrow the members who need a look. Hiatus ones first: they are the reason for this page. */
export const PROBLEM_FILTERS = [
  { id: "all", label: "All", match: () => true },
  { id: "disagree", label: "Hub and Stripe disagree", match: (r: ScheduleRow) => r.status === "hub_stripe_disagree" },
  { id: "charged_hiatus", label: "Charged during a hiatus", match: (r: ScheduleRow) => r.status === "charged_when_not_expected" && r.cause === "hiatus" },
  { id: "missed_after_hiatus", label: "Not billed after a hiatus ended", match: (r: ScheduleRow) => r.status === "missed" && r.cause === "after_hiatus" },
  { id: "unrecorded_gap", label: "Billing gap with no hiatus", match: (r: ScheduleRow) => r.status === "unrecorded_gap" },
  { id: "hiatus_mismatch", label: "Hiatus and billing gap differ", match: (r: ScheduleRow) => r.status === "hiatus_mismatch" },
  { id: "billing_day", label: "Hiatus ended on the billing day, month skipped", match: (r: ScheduleRow) => r.cause === "hiatus_billing_day" },
  { id: "program", label: "Program and membership", match: (r: ScheduleRow) => r.cause === "program" },
  { id: "behind", label: "Behind: nothing paid since an unpaid invoice", match: (r: ScheduleRow) => r.status === "unpaid_behind" },
  { id: "paying_again", label: "Paying again, earlier months unpaid", match: (r: ScheduleRow) => r.status === "unpaid_earlier" },
  { id: "payment", label: "Any unpaid invoice", match: (r: ScheduleRow) => r.status === "unpaid_behind" || r.status === "unpaid_earlier" },
  { id: "missed", label: "Missed", match: (r: ScheduleRow) => r.status === "missed" },
  { id: "unexpected", label: "Unexpected payment", match: (r: ScheduleRow) => r.status === "unexpected" },
  { id: "missing_payment", label: "Bought, no Stripe payment (events, programs, courses)", match: (r: ScheduleRow) => r.status === "missing_payment" },
  { id: "unexplained_payment", label: "Paid, not explained (events)", match: (r: ScheduleRow) => r.status === "unexplained_payment" },
  { id: "granted", label: "Granted purchases", match: (r: ScheduleRow) => r.cause === "granted" },
] as const;
export type ProblemFilterId = (typeof PROBLEM_FILTERS)[number]["id"];

export const parseProblemFilter = (value: string | undefined): ProblemFilterId => PROBLEM_FILTERS.find((f) => f.id === value)?.id ?? "all";

/** The summary, the filters, and the members with at least one matching row that needs a look, each linking to their Transactions tab. */
export default function BillingOverview({ overview, filter = "all" }: { overview: Overview; filter?: ProblemFilterId }) {
  const total = summarize(overview.schedules);
  const chosen = PROBLEM_FILTERS.find((f) => f.id === filter) ?? PROBLEM_FILTERS[0];
  const needsLook = overview.schedules.map((schedule) => ({ schedule, rows: schedule.rows.filter((r) => r.needsAttention) }));
  const countOf = (match: (r: ScheduleRow) => boolean) => needsLook.filter((p) => p.rows.some(match)).length;
  const problems = needsLook
    .map((p) => ({ ...p, rows: p.rows.filter(chosen.match) }))
    .filter((p) => p.rows.length > 0)
    .map((p) => ({ ...p, member: overview.members.get(p.schedule.memberId) }))
    // Members who are behind come before those who are only paying again.
    .sort((a, b) => Number(b.rows.some(isBehind)) - Number(a.rows.some(isBehind)) || b.rows.length - a.rows.length || (a.member?.name ?? "").localeCompare(b.member?.name ?? ""));

  if (overview.counts.invoices === 0) {
    return <p className="text-sm text-slate-600 dark:text-slate-400">No Stripe invoices are imported yet, so there is nothing to line up.</p>;
  }

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-slate-900 rounded-lg shadow border border-slate-200 dark:border-slate-800 p-6">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Summary</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
          {overview.counts.linkedMembers} members with a Stripe customer, {overview.counts.invoices} invoices and {overview.counts.purchases} event, program and course purchases, as of {overview.today}.
        </p>
        <ul className="flex flex-wrap gap-3 text-sm">
          {ROW_STATUSES.map((s) => (
            <li key={s}>
              {ROW_STATUS_LABELS[s]}: <strong>{total.byStatus[s]}</strong>
            </li>
          ))}
        </ul>
      </section>

      <nav aria-label="Filter" className="flex flex-wrap gap-2 text-sm">
        {PROBLEM_FILTERS.map((f) => (
          <Link
            key={f.id}
            href={f.id === "all" ? "/admin/hygiene/billing-reconciliation" : `/admin/hygiene/billing-reconciliation?filter=${f.id}`}
            aria-current={f.id === chosen.id ? "page" : undefined}
            className={`rounded-full border px-3 py-1 ${f.id === chosen.id ? "bg-plum-600 text-white border-plum-600" : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300"}`}
          >
            {f.label} ({countOf(f.match)})
          </Link>
        ))}
      </nav>

      <section className="bg-white dark:bg-slate-900 rounded-lg shadow border border-slate-200 dark:border-slate-800">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Members who need a look: {chosen.label}</h2>
          <span className={`text-2xl font-bold ${problems.length > 0 ? "text-orange-500" : "text-green-500"}`}>{problems.length}</span>
        </div>
        {problems.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-green-700 dark:text-green-400 font-medium">
            {chosen.id === "all" ? "Every billing day lines up." : "Nobody here."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400">
                <th className="px-6 py-3">Member</th>
                <th className="px-6 py-3">Purchase</th>
                <th className="px-6 py-3">What is wrong</th>
              </tr>
            </thead>
            <tbody>
              {problems.map(({ schedule, rows, member }) => (
                <tr key={schedule.key ?? `${schedule.memberId}:${schedule.purchaseType}`} className="border-t border-slate-200 dark:border-slate-800 align-top">
                  <td className="px-6 py-3">
                    <Link href={`/admin/members/${schedule.memberId}/transactions`} className="text-plum-600 hover:text-plum-700 dark:text-plum-400 dark:hover:text-plum-300 hover:underline">
                      {member ? getMemberDisplayName({ name: member.name, display_name: member.displayName }) : schedule.memberId}
                    </Link>
                  </td>
                  <td className="px-6 py-3">
                    {schedule.event ? (
                      <Link href={`/admin/events/${schedule.event.slug}`} className="text-plum-600 hover:text-plum-700 dark:text-plum-400 dark:hover:text-plum-300 hover:underline">
                        {schedule.event.title}
                      </Link>
                    ) : (
                      schedule.label
                    )}
                    {schedule.purchase && schedule.purchase.offerName !== schedule.label && <div className="text-xs text-slate-500 dark:text-slate-400">{schedule.purchase.offerName}</div>}
                  </td>
                  <td className="px-6 py-3">
                    <ul className="space-y-1">
                      {rows.slice(-3).reverse().map((r) => (
                        <li key={r.key}>
                          <span className="font-medium">{ROW_STATUS_LABELS[r.status]}</span>: {r.reason}
                        </li>
                      ))}
                      {rows.length > 3 && <li className="text-slate-500 dark:text-slate-400">and {rows.length - 3} more</li>}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
