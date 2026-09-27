"use client";

import Link from "next/link";
import { SortableTh } from "@/components/SortableTh";
import { useDataTable } from "@/lib/hooks/useDataTable";
import type { SortValue } from "@/lib/hooks/useTableSort";
import { DataTablePager } from "@/components/DataTablePager";
import type { ResubscribingMember } from "@/lib/resubscription-data";
import { formatGapLabel } from "@/lib/resubscription-detection";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function GapBadge({ days }: { days: number }) {
  return <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">({formatGapLabel(days)})</span>;
}

type SortColumn = "member" | "times" | "latestRejoin";

function latestRejoin(member: ResubscribingMember): string | null {
  let latest: string | null = null;
  for (const event of member.resubscriptions) {
    if (latest === null || Date.parse(event.resubscribedAt) > Date.parse(latest)) latest = event.resubscribedAt;
  }
  return latest;
}

function getSortValue(member: ResubscribingMember, column: SortColumn): SortValue {
  switch (column) {
    case "member":
      return member.memberName.toLowerCase();
    case "times":
      return member.resubscriptions.length;
    case "latestRejoin":
      return latestRejoin(member);
  }
}

function MemberRow({ member }: { member: ResubscribingMember }) {
  const profileHref = member.memberId ? `/admin/members/${member.memberId}` : null;

  return (
    <tr className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {profileHref ? (
            <Link href={profileHref} className="font-medium text-blue-600 dark:text-blue-400 hover:underline">
              {member.memberName}
            </Link>
          ) : (
            <span className="font-medium text-slate-700 dark:text-slate-300">{member.memberName}</span>
          )}
          {member.isCurrentlyActive ? (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
              active
            </span>
          ) : (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
              cancelled
            </span>
          )}
        </div>
        <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{member.memberEmail}</div>
      </td>
      <td className="px-4 py-3 text-right text-sm font-medium text-slate-700 dark:text-slate-300">
        {member.resubscriptions.length}
      </td>
      <td className="px-4 py-3">
        <div className="space-y-1">
          {member.resubscriptions.map((event, i) => (
            <div key={i} className="text-sm text-slate-600 dark:text-slate-400">
              <span className="text-slate-400 dark:text-slate-500 text-xs">Cancelled</span> {formatDate(event.cancelledAt)}
              <span className="mx-2 text-slate-300 dark:text-slate-600">→</span>
              <span className="text-slate-400 dark:text-slate-500 text-xs">Rejoined</span>{" "}
              <span className="text-green-600 dark:text-green-400 font-medium">{formatDate(event.resubscribedAt)}</span>
              <GapBadge days={event.gapDays} />
            </div>
          ))}
        </div>
      </td>
    </tr>
  );
}

export default function ResubscribingMembersTable({ members }: { members: ResubscribingMember[] }) {
  const table = useDataTable<ResubscribingMember, SortColumn>({
    rows: members,
    getSortValue,
    defaultSort: { column: "member", direction: "asc" },
  });
  const { sortColumn, sortDirection, handleSort } = table;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-800/50">
          <tr className="border-b border-slate-100 dark:border-slate-800">
            <SortableTh
              label="Member"
              active={sortColumn === "member"}
              direction={sortDirection}
              onClick={() => handleSort("member")}
            />
            <SortableTh
              label="Times"
              align="right"
              active={sortColumn === "times"}
              direction={sortDirection}
              onClick={() => handleSort("times")}
            />
            <SortableTh
              label="History (latest rejoin)"
              active={sortColumn === "latestRejoin"}
              direction={sortDirection}
              onClick={() => handleSort("latestRejoin")}
            />
          </tr>
        </thead>
        <tbody>
          {table.rows.map((member) => (
            <MemberRow key={member.memberEmail} member={member} />
          ))}
        </tbody>
      </table>
      <DataTablePager table={table} itemLabel="members" />
    </div>
  );
}
