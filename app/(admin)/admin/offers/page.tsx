import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { coverageState, loadOfferCoverage, type OfferCoverageState } from "@/lib/offer-coverage";

export const metadata: Metadata = { title: "Kajabi Offers" };

const STATE_LABEL: Record<OfferCoverageState, string> = {
  mapped: "Mapped",
  unmapped: "Not in the Hub yet",
  multiple: "More than one resource",
};
const STATE_CLASS: Record<OfferCoverageState, string> = {
  mapped: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  unmapped: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  multiple: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

export default async function AdminOffersPage() {
  await requireAdminPage();
  const supabase = await createClient();
  const rows = await loadOfferCoverage(createRepos(supabase));
  const counts = { mapped: 0, unmapped: 0, multiple: 0 };
  for (const row of rows) counts[coverageState(row)]++;

  return (
    <div className="container mx-auto max-w-6xl px-6 py-8">
      <h1 className="mb-2 text-3xl font-bold">Kajabi Offers</h1>
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
        Before we leave Kajabi, each offer should be matched to exactly one resource in the Hub. An offer that matches none is something
        the Hub doesn&apos;t represent yet. Link offers from an{" "}
        <Link href="/admin/events" className="underline">
          event
        </Link>
        , a{" "}
        <Link href="/admin/programs" className="underline">
          program
        </Link>
        , or a{" "}
        <Link href="/admin/courses" className="underline">
          course
        </Link>{" "}
        (courses take theirs from Kajabi).
      </p>
      <p className="mb-6 text-sm">
        {rows.length} offers: {counts.mapped} mapped, {counts.unmapped} not in the Hub yet, {counts.multiple} with more than one resource.
      </p>

      <div className="overflow-x-auto rounded-lg bg-white shadow dark:bg-slate-900">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600 dark:border-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">Offer</th>
              <th className="px-4 py-3">State</th>
              <th className="px-4 py-3">Hub resources</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const state = coverageState(row);
              return (
                <tr key={row.offerId} className="border-b border-slate-100 align-top last:border-0 dark:border-slate-800">
                  <td className="px-4 py-3">
                    {row.name}
                    {row.status && <span className="ml-2 text-xs text-slate-500">{row.status}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATE_CLASS[state]}`}>{STATE_LABEL[state]}</span>
                  </td>
                  <td className="px-4 py-3">
                    {row.resources.length === 0 ? (
                      <span className="text-slate-500">None</span>
                    ) : (
                      <ul className="space-y-1">
                        {row.resources.map((r) => (
                          <li key={`${r.kind}:${r.href}`}>
                            <span className="mr-2 text-xs uppercase text-slate-500">{r.kind}</span>
                            <Link href={r.href} className="text-plum-700 hover:underline dark:text-plum-300">
                              {r.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
