"use client";

import { useState } from "react";
import { ROW_STATUSES, ROW_STATUS_LABELS, summarize, type PurchaseSchedule, type RowStatus } from "@/lib/billing-reconciliation";
import { formatCents, stripeInvoiceUrl } from "@/lib/member-transactions";

const STATUS_CLASS: Record<RowStatus, string> = {
  paid: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  refunded: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  missed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  open: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  charged_when_not_expected: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  unexpected: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  not_expected: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

interface Props {
  schedules: PurchaseSchedule[];
  /** Start with only the rows that need a look (when there are any). */
  problemsFirst?: boolean;
}

/**
 * Each purchase as a schedule: the billing days the Hub expects, lined up with what Stripe did, and a
 * status for each. A summary of the statuses on top and a switch to only the rows that need a look.
 */
export default function BillingSchedule({ schedules, problemsFirst = true }: Props) {
  const summary = summarize(schedules);
  const [onlyProblems, setOnlyProblems] = useState(problemsFirst && summary.needsAttention > 0);

  if (schedules.length === 0) {
    return <p className="text-sm text-slate-600 dark:text-slate-400">No membership billing to line up for this member.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" aria-label="Summary">
        {ROW_STATUSES.filter((s) => summary.byStatus[s] > 0).map((s) => (
          <span key={s} className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[s]}`}>
            {ROW_STATUS_LABELS[s]}: {summary.byStatus[s]}
          </span>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
          Only rows that need a look ({summary.needsAttention})
        </label>
      </div>
      {schedules.map((schedule) => {
        const rows = schedule.rows.filter((r) => !onlyProblems || r.needsAttention).slice().reverse();
        return (
          <section key={`${schedule.memberId}:${schedule.purchaseType}`} aria-label={schedule.label}>
            <h3 className="text-sm font-semibold">
              {schedule.label}
              {schedule.start && (
                <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
                  from {schedule.start}
                  {schedule.end ? ` to ${schedule.end}` : ""}
                </span>
              )}
            </h3>
            {rows.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">Nothing here needs a look.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400">
                      <th className="px-3 py-2">Expected</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">What happened</th>
                      <th className="px-3 py-2">Stripe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.key} className="border-t border-slate-200 dark:border-slate-700 align-top">
                        <td className="px-3 py-2 whitespace-nowrap">{row.expectedDate ?? <span className="text-slate-500">none</span>}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {row.expectedAmountCents === null ? "" : formatCents(row.expectedAmountCents, row.currency)}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[row.status]}`}>{ROW_STATUS_LABELS[row.status]}</span>
                        </td>
                        <td className="px-3 py-2">{row.reason}</td>
                        <td className="px-3 py-2">
                          {row.transactions.map((t) => (
                            <a
                              key={t.invoiceId}
                              href={stripeInvoiceUrl(t.invoiceId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block text-plum-600 hover:text-plum-700 dark:text-plum-400 dark:hover:text-plum-300 hover:underline"
                            >
                              {t.invoiceId}
                            </a>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
