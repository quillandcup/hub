"use client";

import Link from "next/link";
import { SortableTh } from "@/components/SortableTh";
import { useTableSort } from "@/lib/hooks/useTableSort";
import { parseDateOnly } from "@/lib/member-tenure";

export interface HedgieversaryRow {
  id: string;
  name: string;
  email: string;
  firstJoinedAt: string;
  mostRecentJoinedAt: string | null;
  totalActiveMonths: number;
  nextDate: string | null; // null = TBD (currently on an indefinite hiatus)
  milestoneMonths: number | null;
}

type SortColumn = "name" | "firstJoinedAt" | "mostRecentJoinedAt" | "totalActiveMonths" | "nextDate";

function milestoneLabel(months: number): string {
  return months < 12 ? `${months}-Month` : `${Math.round(months / 12)}-Year`;
}

function getSortValue(row: HedgieversaryRow, column: SortColumn): string | number {
  switch (column) {
    case "name":
      return row.name.toLowerCase();
    case "firstJoinedAt":
      return parseDateOnly(row.firstJoinedAt).getTime();
    case "mostRecentJoinedAt":
      return row.mostRecentJoinedAt ? parseDateOnly(row.mostRecentJoinedAt).getTime() : 0;
    case "totalActiveMonths":
      return row.totalActiveMonths;
    case "nextDate":
      // TBD (indefinite hiatus) sorts last in ascending order.
      return row.nextDate ? parseDateOnly(row.nextDate).getTime() : Infinity;
  }
}

export default function HedgieversariesTable({ rows }: { rows: HedgieversaryRow[] }) {
  const { sortColumn, sortDirection, handleSort, sortedRows } = useTableSort<HedgieversaryRow, SortColumn>({
    rows,
    getSortValue,
    defaultSort: { column: "nextDate", direction: "asc" },
  });

  const fmt = (dateOnly: string) =>
    parseDateOnly(dateOnly).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-50 dark:bg-slate-800">
          <tr>
            <SortableTh label="Hedgie" active={sortColumn === "name"} direction={sortDirection} onClick={() => handleSort("name")} />
            <SortableTh label="First Joined" active={sortColumn === "firstJoinedAt"} direction={sortDirection} onClick={() => handleSort("firstJoinedAt")} />
            <SortableTh label="Most Recent Joined" active={sortColumn === "mostRecentJoinedAt"} direction={sortDirection} onClick={() => handleSort("mostRecentJoinedAt")} />
            <SortableTh label="Total Active Months" active={sortColumn === "totalActiveMonths"} direction={sortDirection} onClick={() => handleSort("totalActiveMonths")} />
            <SortableTh label="Next Hedgieversary" active={sortColumn === "nextDate"} direction={sortDirection} onClick={() => handleSort("nextDate")} />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
          {sortedRows.map((row) => {
            const isWelcomeBack = !!(row.mostRecentJoinedAt && row.mostRecentJoinedAt !== row.firstJoinedAt);
            return (
              <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                <td className="px-6 py-4 whitespace-nowrap">
                  <Link
                    href={`/admin/members/${row.id}`}
                    className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700 dark:text-slate-300">
                  {fmt(row.firstJoinedAt)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700 dark:text-slate-300">
                  {row.mostRecentJoinedAt ? fmt(row.mostRecentJoinedAt) : "—"}
                  {isWelcomeBack && (
                    <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                      Welcome back
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700 dark:text-slate-300">
                  {row.totalActiveMonths}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {row.nextDate ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{fmt(row.nextDate)}</span>
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                        {row.milestoneMonths != null ? milestoneLabel(row.milestoneMonths) : ""}
                      </span>
                    </span>
                  ) : (
                    <span className="text-sm text-slate-400 dark:text-slate-500">TBD (on hiatus)</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="p-12 text-center text-slate-500 dark:text-slate-400">No members to show yet.</div>
      )}
    </div>
  );
}
