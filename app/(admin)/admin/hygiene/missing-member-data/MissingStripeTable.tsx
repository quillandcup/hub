"use client";

import Link from "next/link";
import { SortableTh } from "@/components/SortableTh";
import { useTableSort, type SortValue } from "@/lib/hooks/useTableSort";
import { Pagination } from "@/components/Pagination";
import { usePagination } from "@/lib/hooks/usePagination";

export interface MissingStripeRow {
  id: string;
  name: string;
  email: string;
  kajabi_id: string | null;
}

type SortColumn = "name" | "email" | "kajabi";

function getSortValue(row: MissingStripeRow, column: SortColumn): SortValue {
  switch (column) {
    case "name":
      return row.name.toLowerCase();
    case "email":
      return row.email.toLowerCase();
    case "kajabi":
      return row.kajabi_id;
  }
}

export default function MissingStripeTable({ rows }: { rows: MissingStripeRow[] }) {
  const { sortColumn, sortDirection, handleSort, sortedRows } = useTableSort<MissingStripeRow, SortColumn>({
    rows,
    getSortValue,
    defaultSort: { column: "name", direction: "asc" },
  });
  const pagination = usePagination({ rows: sortedRows, resetKey: `${sortColumn}:${sortDirection}` });
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
            {th("Email", "email")}
            {th("Kajabi", "kajabi")}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
          {pagination.pageRows.map((member) => (
            <tr key={member.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
              <td className="px-6 py-3">
                <Link
                  href={`/admin/members/${member.id}`}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
                >
                  {member.name}
                </Link>
              </td>
              <td className="px-6 py-3 text-sm text-slate-600 dark:text-slate-400">{member.email}</td>
              <td className="px-6 py-3">
                {member.kajabi_id ? (
                  <a
                    href={`https://app.kajabi.com/admin/contacts/${member.kajabi_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {member.kajabi_id}
                  </a>
                ) : (
                  <span className="text-xs text-slate-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination {...pagination.paginationProps} itemLabel="members" />
    </div>
  );
}
