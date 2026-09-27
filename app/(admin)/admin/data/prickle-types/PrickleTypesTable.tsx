"use client";

import Link from "next/link";
import { SortableTh } from "@/components/SortableTh";
import { useDataTable } from "@/lib/hooks/useDataTable";
import type { SortValue } from "@/lib/hooks/useTableSort";
import { DataTablePager } from "@/components/DataTablePager";

export interface PrickleTypeRow {
  id: string;
  name: string;
  normalized_name: string;
  description: string | null;
  purpose: string;
  solo_task_friendly: boolean;
}

const PURPOSE_STYLES: Record<string, string> = {
  writing: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  work: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  social: "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  mixed: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

function PurposeBadge({ purpose }: { purpose: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
        PURPOSE_STYLES[purpose] ?? PURPOSE_STYLES.mixed
      }`}
    >
      {purpose}
    </span>
  );
}

function SoloTaskFriendlyBadge({ soloTaskFriendly }: { soloTaskFriendly: boolean }) {
  return soloTaskFriendly ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
      Yes
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
      No
    </span>
  );
}

type SortColumn = "name" | "normalized" | "description" | "purpose" | "soloTaskFriendly";

function getSortValue(row: PrickleTypeRow, column: SortColumn): SortValue {
  switch (column) {
    case "name":
      return row.name.toLowerCase();
    case "normalized":
      return row.normalized_name;
    case "description":
      return row.description?.toLowerCase() || null;
    case "purpose":
      return row.purpose;
    case "soloTaskFriendly":
      // Ascending puts "Yes" first.
      return row.solo_task_friendly ? 0 : 1;
  }
}

export default function PrickleTypesTable({ rows }: { rows: PrickleTypeRow[] }) {
  const table = useDataTable<PrickleTypeRow, SortColumn>({
    rows,
    getSortValue,
    defaultSort: { column: "name", direction: "asc" },
  });
  const { sortColumn, sortDirection, handleSort } = table;
  const th = (label: string, column: SortColumn) => (
    <SortableTh
      label={label}
      active={sortColumn === column}
      direction={sortDirection}
      onClick={() => handleSort(column)}
    />
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-50 dark:bg-slate-800">
          <tr>
            {th("Name", "name")}
            {th("Normalized", "normalized")}
            {th("Description", "description")}
            {th("Purpose", "purpose")}
            {th("BYO-Task Friendly", "soloTaskFriendly")}
            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
          {table.rows.map((type) => (
            <tr key={type.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
              <td className="px-6 py-4">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{type.name}</div>
              </td>
              <td className="px-6 py-4">
                <div className="text-sm text-slate-600 dark:text-slate-400 font-mono">{type.normalized_name}</div>
              </td>
              <td className="px-6 py-4 max-w-xs">
                <div className="text-sm text-slate-600 dark:text-slate-400 truncate" title={type.description ?? ""}>
                  {type.description ?? <span className="text-slate-400 dark:text-slate-600 italic">—</span>}
                </div>
              </td>
              <td className="px-6 py-4">
                <PurposeBadge purpose={type.purpose} />
              </td>
              <td className="px-6 py-4">
                <SoloTaskFriendlyBadge soloTaskFriendly={type.solo_task_friendly} />
              </td>
              <td className="px-6 py-4">
                <Link
                  href={`/admin/data/prickle-types/${type.id}/edit`}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Edit
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <DataTablePager table={table} itemLabel="types" />
    </div>
  );
}
