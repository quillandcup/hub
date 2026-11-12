"use client";

import { useState } from "react";
import Link from "next/link";
import { DataTablePager } from "@/components/DataTablePager";
import { DataTableSearch } from "@/components/DataTableSearch";
import { SortableTh } from "@/components/SortableTh";
import { useDataTable } from "@/lib/hooks/useDataTable";
import { coverageState, type OfferCoverageRow, type OfferCoverageState } from "@/lib/offer-coverage";

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
// Open questions first when sorting by state.
const STATE_RANK: Record<OfferCoverageState, number> = { multiple: 0, unmapped: 1, mapped: 2 };

type Column = "offer" | "state" | "resources";

export default function OffersTable({ rows }: { rows: OfferCoverageRow[] }) {
  const [filter, setFilter] = useState<OfferCoverageState | "all">("all");
  const shown = filter === "all" ? rows : rows.filter((r) => coverageState(r) === filter);
  const table = useDataTable<OfferCoverageRow, Column>({
    rows: shown,
    resetKey: filter,
    // Name, id, state and the resources it maps to.
    search: (row) => [row.name, row.offerId, STATE_LABEL[coverageState(row)], ...row.resources.flatMap((r) => [r.kind, r.title])].join(" "),
    defaultSort: { column: "state", direction: "asc" },
    getSortValue: (row, column) => {
      if (column === "offer") return row.name.toLowerCase();
      if (column === "state") return STATE_RANK[coverageState(row)];
      return row.resources[0]?.title.toLowerCase() ?? "";
    },
  });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <DataTableSearch table={table} label="Search offers" />
        <label htmlFor="offer-state-filter">Show</label>
        <select
          id="offer-state-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value as OfferCoverageState | "all")}
          className="rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
        >
          <option value="all">All offers</option>
          <option value="unmapped">{STATE_LABEL.unmapped}</option>
          <option value="multiple">{STATE_LABEL.multiple}</option>
          <option value="mapped">{STATE_LABEL.mapped}</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg bg-white shadow dark:bg-slate-900">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800">
            <tr>
              <SortableTh label="Offer" {...table.sortProps("offer")} />
              <SortableTh label="State" {...table.sortProps("state")} />
              <SortableTh label="Hub resources" {...table.sortProps("resources")} />
              <th className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-400">In Kajabi</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => {
              const state = coverageState(row);
              return (
                <tr key={row.offerId} className="border-b border-slate-100 align-top last:border-0 dark:border-slate-800">
                  <td className="px-6 py-3">
                    {row.name}
                    {row.status && <span className="ml-2 text-xs text-slate-500">{row.status}</span>}
                  </td>
                  <td className="px-6 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATE_CLASS[state]}`}>{STATE_LABEL[state]}</span>
                  </td>
                  <td className="px-6 py-3">
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
                  <td className="whitespace-nowrap px-6 py-3">
                    {row.kajabiUrl && (
                      <a href={row.kajabiUrl} target="_blank" rel="noreferrer" className="text-plum-700 hover:underline dark:text-plum-300">
                        Edit
                      </a>
                    )}
                    {row.checkoutUrl && (
                      <a href={row.checkoutUrl} target="_blank" rel="noreferrer" className="ml-3 text-plum-700 hover:underline dark:text-plum-300">
                        Checkout
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <DataTablePager table={table} itemLabel="offers" />
    </>
  );
}
