"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import type { PrickleScheduleRow } from "@/lib/prickle-schedule";
import { SortableTh } from "@/components/SortableTh";
import { useDataTable } from "@/lib/hooks/useDataTable";
import type { SortValue } from "@/lib/hooks/useTableSort";

const DAY_ORDER = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function AttendanceHint({ row }: { row: PrickleScheduleRow }) {
  if (row.sessionCount === 0) {
    return <span className="text-slate-400 dark:text-slate-500">New</span>;
  }
  const n = Math.round(row.avgAttendance ?? 0);
  return (
    <span className="text-slate-500 dark:text-slate-400">
      ~{n} {n === 1 ? "Hedgie" : "Hedgies"}
    </span>
  );
}

type SortColumn = "time" | "kind" | "host" | "typically";

// Sorting reorders prickles within each day; the days themselves stay in
// week order since this is a weekly schedule.
function getSortValue(row: PrickleScheduleRow, column: SortColumn): SortValue {
  switch (column) {
    case "time":
      return row.sortKey;
    case "kind":
      return row.typeName.toLowerCase();
    case "host":
      return row.hostName?.toLowerCase() ?? null;
    case "typically":
      return row.sessionCount === 0 ? null : (row.avgAttendance ?? 0);
  }
}

/** Picking recurring slots to commit to: a checkbox per row, keyed by seriesKey. */
export interface TableSlotSelection {
  selected: ReadonlySet<string>;
  onToggle: (seriesKey: string) => void;
}

export default function AllPricklesTable({
  rows,
  selection,
}: {
  rows: PrickleScheduleRow[];
  selection?: TableSlotSelection;
}) {
  const columnCount = selection ? 5 : 4;
  const [typeFilter, setTypeFilter] = useState<string>("all");
  // Grouped under day headers, so it never pages (a page break would split a day).
  const { sortColumn, sortDirection, handleSort, rows: sortedRows } = useDataTable<PrickleScheduleRow, SortColumn>({
    rows,
    getSortValue,
    defaultSort: { column: "time", direction: "asc" },
    paginate: false,
  });

  const types = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) seen.set(r.typeId ?? "notype", r.typeName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filteredByDay = useMemo(() => {
    const filtered =
      typeFilter === "all" ? sortedRows : sortedRows.filter((r) => (r.typeId ?? "notype") === typeFilter);
    const byDay = new Map<string, PrickleScheduleRow[]>();
    for (const r of filtered) {
      const list = byDay.get(r.dayOfWeek) ?? [];
      list.push(r);
      byDay.set(r.dayOfWeek, list);
    }
    return DAY_ORDER.map((day) => ({ day, rows: byDay.get(day) ?? [] })).filter((g) => g.rows.length > 0);
  }, [sortedRows, typeFilter]);

  return (
    <div>
      {types.length > 1 && (
        <div className="flex justify-end mb-3">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          >
            <option value="all">All Prickles</option>
            {types.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}

      {filteredByDay.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No prickles match that filter.</p>
      ) : (
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="text-left text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">
              {selection && (
                <th className="pb-2 pr-2 font-medium w-8">
                  <span className="sr-only">Commit</span>
                </th>
              )}
              {(
                [
                  ["Time", "time", "left"],
                  ["Kind", "kind", "left"],
                  ["Host", "host", "left"],
                  ["Typically", "typically", "right"],
                ] as const
              ).map(([label, column, align]) => (
                <SortableTh
                  key={column}
                  label={label}
                  align={align}
                  className="pb-2 pr-2 font-medium"
                  active={sortColumn === column}
                  direction={sortDirection}
                  onClick={() => handleSort(column)}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredByDay.map(({ day, rows: dayRows }) => (
              <Fragment key={day}>
                <tr>
                  <td
                    colSpan={columnCount}
                    className="pt-4 pb-1.5 text-sm font-semibold text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800"
                  >
                    {day}
                  </td>
                </tr>
                {dayRows.map((row) => (
                  <tr
                    key={row.seriesKey}
                    className={`group ${selection?.selected.has(row.seriesKey) ? "bg-blue-50 dark:bg-blue-950/40" : ""}`}
                  >
                    {selection && (
                      <td className="py-2 pr-2">
                        {row.typeId && (
                          <input
                            type="checkbox"
                            checked={selection.selected.has(row.seriesKey)}
                            onChange={() => selection.onToggle(row.seriesKey)}
                            aria-label={`Commit to ${row.dayOfWeek} ${row.timeLabel} ${row.typeName}`}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600"
                          />
                        )}
                      </td>
                    )}
                    <td className="py-0">
                      <Link
                        href={`/prickles/${row.nextOccurrenceId}`}
                        className="flex items-center py-2 pr-2 text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400"
                      >
                        {row.timeLabel}
                      </Link>
                    </td>
                    <td className="py-2 pr-2 text-slate-600 dark:text-slate-300">{row.typeName}</td>
                    <td className="py-2 pr-2 text-slate-500 dark:text-slate-400">{row.hostName ?? "—"}</td>
                    <td className="py-2 text-right">
                      <AttendanceHint row={row} />
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
