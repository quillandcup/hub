import { formatCents, type TransactionRow, type TransactionTone } from "@/lib/member-transactions";

const TONE_CLASS: Record<TransactionTone, string> = {
  good: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  bad: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  neutral: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

interface Props {
  rows: TransactionRow[];
  /** How many Stripe customers were searched (the linked one, plus any other with the member's email). */
  customerCount: number;
}

/** A member's Stripe invoices and charges from the Bronze copy, newest first, each linking to Stripe. */
export default function MemberTransactionsPanel({ rows, customerCount }: Props) {
  return (
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-600 dark:text-slate-400">
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 pr-4 font-medium">Description</th>
                <th className="py-2 pr-4 font-medium text-right">Amount</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Stripe</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-200 dark:border-slate-700 align-top">
                  <td className="py-2 pr-4 whitespace-nowrap">{row.createdLabel}</td>
                  <td className="py-2 pr-4">
                    <span>{row.description}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{row.kind === "invoice" ? "Invoice" : "Payment"}</span>
                  </td>
                  <td className="py-2 pr-4 text-right whitespace-nowrap">
                    {formatCents(row.amountCents, row.currency)}
                    {row.refundedCents > 0 && (
                      <span className="block text-xs text-slate-500 dark:text-slate-400">{formatCents(row.refundedCents, row.currency)} refunded</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASS[row.tone]}`}>{row.statusLabel}</span>
                    {row.failureCode && <span className="block text-xs text-slate-500 dark:text-slate-400">{row.failureCode.replace(/_/g, " ")}</span>}
                    {row.attempts > 1 && <span className="block text-xs text-slate-500 dark:text-slate-400">{row.attempts} attempts</span>}
                  </td>
                  <td className="py-2">
                    <a href={row.dashboardUrl} target="_blank" rel="noopener noreferrer" className="text-plum-600 hover:text-plum-700 dark:text-plum-400 dark:hover:text-plum-300 hover:underline">
                      {row.id}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
