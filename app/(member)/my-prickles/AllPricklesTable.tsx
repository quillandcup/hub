"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import type { PrickleScheduleRow } from "@/lib/prickle-schedule";

const DAY_ORDER = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function AttendanceHint({ row }: { row: PrickleScheduleRow }) {
  if (row.sessionCount === 0) {
    return <span className="text-slate-400 dark:text-slate-500">New</span>;
  }
  return <span className="text-slate-500 dark:text-slate-400">~{Math.round(row.avgAttendance ?? 0)} usually</span>;
}

export default function AllPricklesTable({ rows }: { rows: PrickleScheduleRow[] }) {
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const types = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) seen.set(r.typeId ?? "notype", r.typeName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filteredByDay = useMemo(() => {
    const filtered = typeFilter === "all" ? rows : rows.filter((r) => (r.typeId ?? "notype") === typeFilter);
    const byDay = new Map<string, PrickleScheduleRow[]>();
    for (const r of filtered) {
      const list = byDay.get(r.dayOfWeek) ?? [];
      list.push(r);
      byDay.set(r.dayOfWeek, list);
    }
    return DAY_ORDER.map((day) => ({ day, rows: byDay.get(day) ?? [] })).filter((g) => g.rows.length > 0);
  }, [rows, typeFilter]);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            All Prickles
          </h2>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            The full recurring weekly schedule — also known as Prickle Times. Times shown in your timezone.
          </p>
        </div>
        {types.length > 1 && (
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          >
            <option value="all">All kinds</option>
            {types.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}
      </div>

      {filteredByDay.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No prickles match that filter.</p>
      ) : (
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="text-left text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">
              <th className="pb-2 pr-2 font-medium">Time</th>
              <th className="pb-2 pr-2 font-medium">Kind</th>
              <th className="pb-2 pr-2 font-medium">Host</th>
              <th className="pb-2 font-medium text-right">Typically</th>
            </tr>
          </thead>
          <tbody>
            {filteredByDay.map(({ day, rows: dayRows }) => (
              <Fragment key={day}>
                <tr>
                  <td
                    colSpan={4}
                    className="pt-4 pb-1.5 text-sm font-semibold text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800"
                  >
                    {day}
                  </td>
                </tr>
                {dayRows.map((row) => (
                  <tr key={row.seriesKey} className="group">
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
