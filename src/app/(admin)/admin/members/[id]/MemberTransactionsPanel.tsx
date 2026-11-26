"use client";

import { useEffect, useState } from "react";
import { useDataTable } from "@/lib/hooks/useDataTable";
import { SortableTh } from "@/components/SortableTh";
import { DataTablePager } from "@/components/DataTablePager";
import { DataTableSearch } from "@/components/DataTableSearch";
import BillingSchedule from "@/components/BillingSchedule";
import type { AckView } from "@/lib/billing-acknowledgements";
import type { PurchaseSchedule } from "@/lib/billing-reconciliation";
import { formatCents, type TransactionRow, type TransactionTone } from "@/lib/member-transactions";

type View = "flat" | "grouped";
/** The chosen view stays chosen across members and visits (this browser only). */
const VIEW_STORAGE_KEY = "hub.member-transactions-view";

const TONE_CLASS: Record<TransactionTone, string> = {
  good: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  bad: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  neutral: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

type Column = "date" | "description" | "amount" | "status";

interface Props {
  rows: TransactionRow[];
  /** How many Stripe customers were searched (the linked one, plus any other under the member's emails). */
  customerCount: number;
  /** What the Hub expected to be billed against what Stripe did, per purchase. */
  schedules?: PurchaseSchedule[];
  /** What staff decided about a schedule row, by row key. */
  acknowledgements?: Record<string, AckView>;
  /** The person may mark rows and undo it. */
  canAcknowledge?: boolean;
  /** Read the tab again after a mark or an undo. */
  onAcknowledgementChange?: () => void;
}

/** A member's Stripe invoices and charges from the Bronze copy, in the standard sortable, searchable, paged table. */
export default function MemberTransactionsPanel({ rows, customerCount, schedules = [], acknowledgements = {}, canAcknowledge = false, onAcknowledgementChange }: Props) {
  const table = useDataTable<TransactionRow, Column>({
    rows,
    search: (r) => `${r.description} ${r.reason ?? ""} ${r.statusLabel} ${r.id} ${r.createdLabel}`,
    getSortValue: (r, column) => {
      switch (column) {
        case "date":
          return r.createdAt;
        case "description":
          return r.description.toLowerCase();
        case "amount":
          return r.amountCents;
        case "status":
          return r.statusLabel;
      }
    },
    defaultSort: { column: "date", direction: "desc" },
  });

  const [view, setView] = useState<View>("flat");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_STORAGE_KEY);
      if (saved === "flat" || saved === "grouped") setView(saved);
    } catch {
      // storage can be blocked: the default view stays
    }
  }, []);
  const choose = (next: View) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // not remembered, still shown
    }
  };

  return (
    <div className="space-y-6">
    {customerCount > 0 && (
      <div role="group" aria-label="View" className="inline-flex rounded-md border border-slate-300 dark:border-slate-600 overflow-hidden text-sm">
        {([["flat", "Flat list"], ["grouped", "Group by product"]] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={view === id}
            onClick={() => choose(id)}
            className={`px-3 py-1.5 ${view === id ? "bg-plum-600 text-white" : "bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-300"}`}
          >
            {label}
          </button>
        ))}
      </div>
    )}
    {customerCount > 0 && view === "grouped" && (
      <section className="bg-white dark:bg-slate-900 rounded-lg shadow p-6 space-y-3">
        <h2 className="text-lg font-semibold">Billing schedule</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Each product with the billing days the Hub expects (the Stripe subscription, minus hiatuses and programs that include membership) lined up with what Stripe did.
        </p>
        <BillingSchedule schedules={schedules} acknowledgements={acknowledgements} canAcknowledge={canAcknowledge} onAcknowledgementChange={onAcknowledgementChange} />
      </section>
    )}
    {(customerCount === 0 || view === "flat") && (
    <section className="bg-white dark:bg-slate-900 rounded-lg shadow p-6 space-y-3">
      <h2 className="text-lg font-semibold">Transactions</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Invoices and one-off payments from Stripe, as of the last import. Open one in Stripe for the card, receipt and refunds.
      </p>
      {customerCount === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">No Stripe customer is linked to this member.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">No transactions imported for this member yet.</p>
      ) : (
        <>
          <DataTableSearch table={table} label="Search transactions" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <SortableTh label="Date" {...table.sortProps("date")} />
                  <SortableTh label="Description" {...table.sortProps("description")} />
                  <SortableTh label="Amount" align="right" {...table.sortProps("amount")} />
                  <SortableTh label="Status" {...table.sortProps("status")} />
                  <th className="px-6 py-3 text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">Stripe</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-200 dark:border-slate-700 align-top">
                    <td className="px-6 py-2 whitespace-nowrap">{row.createdLabel}</td>
                    <td className="px-6 py-2">
                      <span>{row.description}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        {row.kind === "invoice" ? "Invoice" : "Payment"}
                        {row.reason ? ` · ${row.reason}` : ""}
                      </span>
                    </td>
                    <td className="px-6 py-2 text-right whitespace-nowrap">
                      {formatCents(row.amountCents, row.currency)}
                      {row.refundedCents > 0 && (
                        <span className="block text-xs text-slate-500 dark:text-slate-400">{formatCents(row.refundedCents, row.currency)} refunded</span>
                      )}
                    </td>
                    <td className="px-6 py-2">
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASS[row.tone]}`}>{row.statusLabel}</span>
                      {row.failureCode && <span className="block text-xs text-slate-500 dark:text-slate-400">{row.failureCode.replace(/_/g, " ")}</span>}
                      {row.attempts > 1 && <span className="block text-xs text-slate-500 dark:text-slate-400">{row.attempts} attempts</span>}
                    </td>
                    <td className="px-6 py-2">
                      <a href={row.dashboardUrl} target="_blank" rel="noopener noreferrer" className="text-plum-600 hover:text-plum-700 dark:text-plum-400 dark:hover:text-plum-300 hover:underline">
                        {row.id}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DataTablePager table={table} itemLabel="transactions" />
        </>
      )}
    </section>
    )}
    </div>
  );
}
