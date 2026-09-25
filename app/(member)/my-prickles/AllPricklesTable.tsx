"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PrickleScheduleRow } from "@/lib/prickle-schedule";

const DAY_ORDER = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function AttendanceHint({ row }: { row: PrickleScheduleRow }) {
  if (row.sessionCount === 0) {
    return <span className="text-slate-400 dark:text-slate-500">New — no history yet</span>;
  }
  return (
    <span className="text-slate-500 dark:text-slate-400">
      ~{Math.round(row.avgAttendance ?? 0)} usually attend
    </span>
  );
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
            The full recurring weekly schedule — also known as Prickle Times. All times in ET.
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
        <div className="space-y-6">
          {filteredByDay.map(({ day, rows: dayRows }) => (
            <div key={day}>
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">{day}</h3>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {dayRows.map((row) => (
                  <Link
                    key={row.seriesKey}
                    href={`/prickles/${row.nextOccurrenceId}`}
                    className="flex items-center justify-between gap-4 py-2.5 -mx-2 px-2 rounded hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {row.timeLabel} · {row.typeName}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {row.hostName ? `Hosted by ${row.hostName}` : "No host listed"}
                      </p>
                    </div>
                    <p className="text-xs flex-shrink-0 text-right">
                      <AttendanceHint row={row} />
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
