"use client";

import { useState } from "react";
import { ROW_STATUSES, ROW_STATUS_LABELS, summarize, type PurchaseSchedule, type RowStatus } from "@/lib/billing-reconciliation";
import Link from "next/link";
import { formatCents, stripeChargeUrl, stripeInvoiceUrl } from "@/lib/member-transactions";
import BillingAcknowledge from "@/components/BillingAcknowledge";
import { isAcknowledged, type AckView } from "@/lib/billing-acknowledgements";

/** The badge colors of a row status, shared with the overview table. */
export const STATUS_CLASS: Record<RowStatus, string> = {
  paid: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  refunded: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  missed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  open: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  unpaid_behind: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  unpaid_earlier: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  charged_when_not_expected: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  unexpected: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  not_expected: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  hub_stripe_disagree: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  paused_short: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  hiatus_confirmed: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  hiatus_mismatch: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  unrecorded_gap: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  gap_short: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  missing_payment: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  unexplained_payment: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  forfeited: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  marked_not_attending: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  gifted: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  comped: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  transferred: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  granted_no_payment: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  granted_paid_stripe: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  granted_no_override: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  paid_override_missing: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};

/** "Bought 2026-03-05 · $47.00 every month · quantity 2 · active", the way Kajabi's Purchases tab lines a purchase up. */
function purchaseLine(schedule: PurchaseSchedule): string {
  const p = schedule.purchase;
  if (!p) return "";
  const when = p.granted ? "Granted" : "Bought";
  return [p.day ? `${when} ${p.day}` : null, p.priceText, p.quantity && p.quantity > 1 ? `quantity ${p.quantity}` : null, p.status].filter(Boolean).join(" · ");
}

interface Props {
  schedules: PurchaseSchedule[];
  /** Start with only the rows that need a look (when there are any). */
  problemsFirst?: boolean;
  /** What staff decided about a row, by row key. A row an acknowledgement settles is not counted as needing a look. */
  acknowledgements?: Record<string, AckView>;
  /** The person may mark rows and undo it. */
  canAcknowledge?: boolean;
  /** Called after a mark or an undo, so the page that loaded the schedules can read them again. */
  onAcknowledgementChange?: () => void;
}

/**
 * Each purchase as a schedule: the billing days the Hub expects, lined up with what Stripe did, and a
 * status for each. A summary of the statuses on top and a switch to only the rows that need a look.
 */
export default function BillingSchedule({ schedules, problemsFirst = true, acknowledgements = {}, canAcknowledge = false, onAcknowledgementChange }: Props) {
  const summary = summarize(schedules);
  const settled = (key: string) => isAcknowledged(acknowledgements[key]);
  const toLookAt = schedules.reduce((n, s) => n + s.rows.filter((r) => r.needsAttention && !settled(r.key)).length, 0);
  const [onlyProblems, setOnlyProblems] = useState(problemsFirst && toLookAt > 0);

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
          Only rows that need a look ({toLookAt})
        </label>
      </div>
      {summary.byStatus.hiatus_confirmed + summary.byStatus.hiatus_mismatch + summary.byStatus.unrecorded_gap + summary.byStatus.gap_short > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Billing gaps are inferred from the payments (no payment for a billing period or more between two paid invoices, with no failed payment, cancellation or program
          explaining it) and checked against the Hub&apos;s hiatus records. That is a guess: the invoices show what was billed, not why.
        </p>
      )}
      {summary.byStatus.paused_short + summary.byStatus.hub_stripe_disagree > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Whether a Stripe pause is a hiatus is a guess from its length: about one billing period or less reads as a possible gifted month (Paused, short),
          two or more, or no resume date, as a hiatus. Stripe does not keep when a pause began, so it is counted from the first billing day after the last payment.
        </p>
      )}
      {schedules.map((schedule) => {
        const rows = schedule.rows.filter((r) => !onlyProblems || (r.needsAttention && !settled(r.key))).slice().reverse();
        return (
          <section key={schedule.key ?? `${schedule.memberId}:${schedule.purchaseType}`} aria-label={schedule.label}>
            <h3 className="text-sm font-semibold">
              {schedule.event ? (
                <Link href={`/admin/events/${schedule.event.slug}`} className="text-plum-600 hover:text-plum-700 dark:text-plum-400 dark:hover:text-plum-300 hover:underline">
                  {schedule.label}
                </Link>
              ) : (
                schedule.label
              )}
              {schedule.purchase && schedule.purchase.offerName !== schedule.label && <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">{schedule.purchase.offerName}</span>}
              {schedule.purchase ? (
                <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">{purchaseLine(schedule)}</span>
              ) : schedule.start && (
                <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
                  from {schedule.start}
                  {schedule.end ? ` to ${schedule.end}` : ""}
                </span>
              )}
            </h3>
            {schedule.notes.map((note) => (
              <p key={note} className="text-xs text-slate-500 dark:text-slate-400">
                {note}
              </p>
            ))}
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
                        <td className="px-3 py-2 whitespace-nowrap">
                          {row.expectedDate ?? (schedule.purchaseType !== "membership" && row.transactions[0] ? row.transactions[0].day : <span className="text-slate-500">none</span>)}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {row.expectedAmountCents === null ? "" : formatCents(row.expectedAmountCents, row.currency)}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[row.status]}`}>{ROW_STATUS_LABELS[row.status]}</span>
                        </td>
                        <td className="px-3 py-2">
                          {row.reason}
                          {(acknowledgements[row.key] || (canAcknowledge && row.needsAttention)) && (
                            <div className="mt-2">
                              <BillingAcknowledge
                                rowKey={row.key}
                                label={`${schedule.label} (${ROW_STATUS_LABELS[row.status]})`}
                                ack={acknowledgements[row.key] ?? null}
                                canAcknowledge={canAcknowledge}
                                onChanged={onAcknowledgementChange}
                              />
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {row.transactions.map((t) => (
                            <a
                              key={t.invoiceId}
                              href={t.kind === "charge" ? stripeChargeUrl(t.invoiceId) : stripeInvoiceUrl(t.invoiceId)}
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
