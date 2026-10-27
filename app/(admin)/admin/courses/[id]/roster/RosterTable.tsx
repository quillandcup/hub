"use client";

import Link from "next/link";
import { SortableTh } from "@/components/SortableTh";
import { DataTablePager } from "@/components/DataTablePager";
import { useDataTable } from "@/lib/hooks/useDataTable";
import type { SortValue } from "@/lib/hooks/useTableSort";
import type { RosterRow } from "@/lib/courses/roster";

type Column = "name" | "access" | "progress" | "lastLesson" | "lastActivity";

const CELL = "px-3 py-2 text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-400";
const date = (iso: string) => iso.slice(0, 10);

function sortValue(row: RosterRow, column: Column): SortValue {
  switch (column) {
    case "name": return row.name.toLowerCase();
    case "access": return row.accessActive ? 1 : 0;
    case "progress": return row.total ? row.completed / row.total : 0;
    case "lastLesson": return row.lastLessonTitle?.toLowerCase() ?? null;
    case "lastActivity": return row.lastActivityAt ? new Date(row.lastActivityAt).getTime() : null;
  }
}

export default function RosterTable({ rows }: { rows: RosterRow[] }) {
  const table = useDataTable<RosterRow, Column>({ rows, getSortValue: sortValue, defaultSort: { column: "lastActivity", direction: "desc" } });
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <SortableTh label="Member" className={CELL} {...table.sortProps("name")} />
            <SortableTh label="Access" className={CELL} {...table.sortProps("access")} />
            <SortableTh label="Progress" className={CELL} align="right" {...table.sortProps("progress")} />
            <SortableTh label="Last lesson" className={CELL} {...table.sortProps("lastLesson")} />
            <SortableTh label="Last activity" className={CELL} {...table.sortProps("lastActivity")} />
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r) => (
            <tr key={r.memberId} className="border-t border-slate-100 dark:border-slate-800">
              <td className="px-3 py-2">
                <Link href={`/admin/members/${r.memberId}`} className="font-medium text-plum-700 underline dark:text-plum-300">{r.name}</Link>
              </td>
              <td className="px-3 py-2">
                {r.accessActive ? "Active" : "Ended"} <span className="text-xs text-slate-600 dark:text-slate-400">({r.origin}, {r.endsAt ? `until ${date(r.endsAt)}` : "lifetime"})</span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{r.completed} of {r.total}</td>
              <td className="px-3 py-2">{r.lastLessonTitle ?? "–"}</td>
              <td className="px-3 py-2 tabular-nums">{r.lastActivityAt ? date(r.lastActivityAt) : "Not started"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <DataTablePager table={table} itemLabel="members" />
    </div>
  );
}
