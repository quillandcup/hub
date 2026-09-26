"use client";

import Link from "next/link";
import { SortableTh } from "@/components/SortableTh";
import { useTableSort, type SortValue } from "@/lib/hooks/useTableSort";
import AliasBadges from "./AliasBadges";

export interface MemberAliasRow {
  member: { id: string; name: string; email: string; status: string };
  aliases: { id: string; alias: string; created_at: string }[];
}

type SortColumn = "member" | "aliases" | "status";

function getSortValue(row: MemberAliasRow, column: SortColumn): SortValue {
  switch (column) {
    case "member":
      return row.member.name.toLowerCase();
    case "aliases":
      return row.aliases.length;
    case "status":
      return row.member.status;
  }
}

export default function AliasesTable({ rows }: { rows: MemberAliasRow[] }) {
  const { sortColumn, sortDirection, handleSort, sortedRows } = useTableSort<MemberAliasRow, SortColumn>({
    rows,
    getSortValue,
    defaultSort: { column: "member", direction: "asc" },
  });
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
        <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
          <tr>
            {th("Member", "member")}
            {th("Aliases", "aliases")}
            {th("Status", "status")}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {sortedRows.map(({ member, aliases }) => (
            <tr key={member.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <td className="px-6 py-4 whitespace-nowrap">
                <div>
                  <Link
                    href={`/admin/members/${member.id}`}
                    className="font-medium text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                  >
                    {member.name}
                  </Link>
                  <div className="text-sm text-slate-500 dark:text-slate-400">{member.email}</div>
                </div>
              </td>
              <td className="px-6 py-4">
                <AliasBadges aliases={aliases} />
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span
                  className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    member.status === "active"
                      ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300"
                  }`}
                >
                  {member.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
