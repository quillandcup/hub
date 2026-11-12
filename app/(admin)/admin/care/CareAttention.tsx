import Link from "next/link";
import type { Attention } from "./attention";

/**
 * What is overdue, for everyone who opens the page: the number of care plans waiting for a renewal or a close ("Review
 * due") and the ones that waited too long ("Lapsed"), and, when anything is overdue, whose they are. Lapse is an
 * accountability signal, so it is shown, not hidden under a tab.
 */
export default function CareAttention({ attention }: { attention: Attention }) {
  const { reviewDue, lapsed, byOwner } = attention;
  return (
    <section aria-label="Overdue" className="@container mb-6 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/care/earlier"
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            lapsed > 0 ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
          }`}
        >
          Lapsed: {lapsed}
        </Link>
        <Link
          href="/admin/care"
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            reviewDue > 0 ? "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
          }`}
        >
          Review due: {reviewDue}
        </Link>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {lapsed + reviewDue === 0 ? "Nothing is overdue." : "A care plan is over: renew it or close it. Lapsed ones waited past the grace window."}
        </p>
      </div>
      {byOwner.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[20rem] text-left text-sm">
            <caption className="sr-only">Overdue care plans by owner</caption>
            <thead>
              <tr className="border-b border-slate-200 text-slate-600 dark:border-slate-800 dark:text-slate-400">
                <th scope="col" className="py-1 pr-3 font-medium">Owner</th>
                <th scope="col" className="py-1 pr-3 font-medium">Review due</th>
                <th scope="col" className="py-1 font-medium">Lapsed</th>
              </tr>
            </thead>
            <tbody>
              {byOwner.map((row) => (
                <tr key={row.ownerId ?? "none"} className="border-b border-slate-100 dark:border-slate-800">
                  <th scope="row" className="py-1 pr-3 font-medium">{row.ownerName}</th>
                  <td className="py-1 pr-3">{row.reviewDue}</td>
                  <td className="py-1">{row.lapsed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
