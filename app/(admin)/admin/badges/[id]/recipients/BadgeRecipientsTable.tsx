"use client";

import Link from "next/link";
import { SortableTh } from "@/components/SortableTh";
import { useTableSort } from "@/lib/hooks/useTableSort";
import { parseDateOnly } from "@/lib/member-tenure";
import type { BadgeRecipient } from "@/lib/badges";

type SortColumn = "member" | "level" | "occurrences" | "firstAwardedAt";

function getSortValue(row: BadgeRecipient, column: SortColumn): string | number {
  switch (column) {
    case "member":
      return row.memberName.toLowerCase();
    case "level":
      return row.level ?? -1;
    case "occurrences":
      return row.occurrences;
    case "firstAwardedAt":
      // No date yet (e.g. an automatic badge with no "first eligible" concept) sorts last.
      return row.firstAwardedAt ? parseDateOnly(row.firstAwardedAt).getTime() : Infinity;
  }
}

export default function BadgeRecipientsTable({
  recipients,
  firstAwardedLabel,
}: {
  recipients: BadgeRecipient[];
  firstAwardedLabel: string;
}) {
  const { sortColumn, sortDirection, handleSort, sortedRows } = useTableSort<BadgeRecipient, SortColumn>({
    rows: recipients,
    getSortValue,
    defaultSort: { column: "member", direction: "asc" },
  });

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
        <thead className="bg-slate-50 dark:bg-slate-800/50">
          <tr>
            <SortableTh
              label="Member"
              active={sortColumn === "member"}
              direction={sortDirection}
              onClick={() => handleSort("member")}
            />
            <SortableTh
              label="Level"
              active={sortColumn === "level"}
              direction={sortDirection}
              onClick={() => handleSort("level")}
            />
            <SortableTh
              label="Occurrences"
              active={sortColumn === "occurrences"}
              direction={sortDirection}
              onClick={() => handleSort("occurrences")}
            />
            <SortableTh
              label={firstAwardedLabel}
              active={sortColumn === "firstAwardedAt"}
              direction={sortDirection}
              onClick={() => handleSort("firstAwardedAt")}
            />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {sortedRows.map((recipient) => (
            <tr key={recipient.memberId}>
              <td className="px-6 py-4 whitespace-nowrap">
                <Link
                  href={`/admin/members/${recipient.memberId}`}
                  className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {recipient.memberName}
                </Link>
                <div className="text-sm text-slate-500 dark:text-slate-400">{recipient.memberEmail}</div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700 dark:text-slate-300">
                {recipient.levelName}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700 dark:text-slate-300">
                {recipient.occurrences}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
                {recipient.firstAwardedAt ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
