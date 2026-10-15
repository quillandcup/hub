"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SortableTh } from "@/components/SortableTh";
import { useDataTable } from "@/lib/hooks/useDataTable";
import type { SortValue } from "@/lib/hooks/useTableSort";
import CheckinPills from "@/components/CheckinPills";
import type { CheckinInput } from "@/lib/prickle-checkins";
import type { CheckinHalf } from "@/app/(member)/prickles/checkin-actions";
import { DataTablePager } from "@/components/DataTablePager";

interface Props {
  attendance: any[];
  timezone: string;
  activeListDateKey: string | undefined;
  memberId: string;
  memberBasePath?: string;
  prickleBasePath?: string;
  /**
   * The viewer's own saved check-ins by prickle id. Passing it (even empty) with onOpenCheck adds a
   * "Check in →" / "Check out →" pill pair to each row; omit them to show someone else's history.
   */
  checkins?: Record<string, CheckinInput>;
  onOpenCheck?: (prickleId: string, half: CheckinHalf) => void;
}

// dateKey format: "MM/DD/YYYY"
function parseDateKey(k: string): number {
  const [m, d, y] = k.split("/").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function formatDateKey(dateKey: string): string {
  const [m, d, y] = dateKey.split("/").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type SortColumn = "type" | "time" | "duration" | "host";

// Rows are sorted within each date group; the groups themselves always stay
// newest-first so the month grid's scroll-to-date keeps working.
function getSortValue(record: any, column: SortColumn): SortValue {
  switch (column) {
    case "type":
      return record.prickles?.prickle_types?.name?.toLowerCase() ?? null;
    case "time":
      return record.join_time;
    case "duration":
      return (new Date(record.leave_time).getTime() - new Date(record.join_time).getTime()) / 60000;
    case "host":
      return record.prickles?.host?.name?.toLowerCase() ?? null;
  }
}

export default function AttendanceListTable({
  attendance,
  timezone,
  activeListDateKey,
  memberId,
  memberBasePath = "/members",
  prickleBasePath = "/prickles",
  checkins,
  onOpenCheck,
}: Props) {
  const router = useRouter();
  const showPills = checkins !== undefined && onOpenCheck !== undefined;
  const columnCount = showPills ? 5 : 4;
  // Pages once there are many rows; the date groups are formed from the current page. Moving to
  // another date (the calendar's prev/next) jumps to the page holding it (reveal).
  const dateKeyOf = (record: any) =>
    new Date(record.join_time).toLocaleDateString("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  const table = useDataTable<any, SortColumn>({
    rows: attendance,
    getSortValue,
    defaultSort: null,
    pageSize: 25,
    reveal: { key: activeListDateKey, getRowKey: dateKeyOf },
  });
  const { sortColumn, sortDirection, handleSort, rows: sortedRows } = table;

  const byDate = new Map<string, any[]>();
  sortedRows.forEach((record) => {
    const key = dateKeyOf(record);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(record);
  });

  const descendingDateKeys = [...byDate.keys()].sort((a, b) => parseDateKey(b) - parseDateKey(a));

  const formatTime = (date: Date) =>
    date.toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" });

  // Scroll to the active date section when it changes
  useEffect(() => {
    if (!activeListDateKey) return;
    const id = `list-date-${activeListDateKey.replace(/\//g, "-")}`;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeListDateKey]);

  if (attendance.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
        <div className="p-12 text-center text-slate-500 dark:text-slate-400">
          No attendance records for this member
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0">
            <tr>
              <SortableTh
                label="Prickle Type"
                active={sortColumn === "type"}
                direction={sortDirection}
                onClick={() => handleSort("type")}
              />
              <SortableTh
                label="Time"
                active={sortColumn === "time"}
                direction={sortDirection}
                onClick={() => handleSort("time")}
              />
              <SortableTh
                label="Duration"
                active={sortColumn === "duration"}
                direction={sortDirection}
                onClick={() => handleSort("duration")}
              />
              <SortableTh
                label="Host"
                active={sortColumn === "host"}
                direction={sortDirection}
                onClick={() => handleSort("host")}
              />
              {showPills && (
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Check in / out
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {descendingDateKeys.map((dateKey) => {
              const records = byDate.get(dateKey) || [];
              const isActive = dateKey === activeListDateKey;
              return (
                <>
                  <tr key={`header-${dateKey}`} id={`list-date-${dateKey.replace(/\//g, "-")}`}>
                    <td
                      colSpan={columnCount}
                      className={`px-6 py-2 text-sm font-semibold border-t-2 ${
                        isActive
                          ? "border-plum-500 bg-plum-50 dark:bg-plum-950 text-plum-900 dark:text-plum-100"
                          : "border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {formatDateKey(dateKey)}
                    </td>
                  </tr>
                  {records.map((record: any) => {
                    const prickle = record.prickles;
                    const joinTime = new Date(record.join_time);
                    const leaveTime = new Date(record.leave_time);
                    const duration = Math.round(
                      (leaveTime.getTime() - joinTime.getTime()) / 60000
                    );
                    return (
                      <tr
                        key={record.id}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                        onClick={() => router.push(`${prickleBasePath}/${prickle.id}`)}
                      >
                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                            {prickle.host?.id === memberId && "⭐ "}
                            {prickle.prickle_types?.name || "Unknown"}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                          {formatTime(joinTime)} – {formatTime(leaveTime)}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                          {duration} min
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                          {prickle.host ? (
                            <Link
                              href={`${memberBasePath}/${prickle.host.id}`}
                              className="text-plum-600 hover:text-plum-700 dark:text-plum-400 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {prickle.host.name}
                            </Link>
                          ) : (
                            "None"
                          )}
                        </td>
                        {showPills && (
                          <td className="px-6 py-4">
                            <CheckinPills prickleId={prickle.id} checkin={checkins![prickle.id] ?? null} onOpen={onOpenCheck!} />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
      <DataTablePager table={table} itemLabel="attendances" />
    </div>
  );
}
