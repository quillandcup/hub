"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { TypeStats } from "@/lib/scheduled-prickle-stats";

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <span className="text-slate-400 text-sm">—</span>;
  }
  const W = 80;
  const H = 24;
  const PAD = 2;
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const points = values
    .map((v, i) => {
      const x = PAD + (i / (values.length - 1)) * (W - PAD * 2);
      const y = H - PAD - ((v - minV) / range) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
      className="inline-block text-blue-500 dark:text-blue-400"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NumericColumn = "sessions" | "min" | "median" | "mean" | "max";
type SortColumn = NumericColumn | "lastSession" | "name";

interface Props {
  rows: TypeStats[];
  from?: string;
  to?: string;
}

function buildRangeUrl(from?: string, to?: string): string {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PricklesTable({ rows, from, to }: Props) {
  const [sortCol, setSortCol] = useState<SortColumn>("sessions");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filters, setFilters] = useState<Partial<Record<NumericColumn, string>>>({});

  function handleSort(col: SortColumn) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir(col === "name" || col === "lastSession" ? "asc" : "desc");
    }
  }

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      for (const [col, val] of Object.entries(filters) as [NumericColumn, string][]) {
        if (!val) continue;
        const threshold = parseFloat(val);
        if (isNaN(threshold)) continue;
        if (row[col] > threshold) return false;
      }
      return true;
    });
  }, [rows, filters]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortCol === "name") {
        cmp = a.typeName.localeCompare(b.typeName);
      } else if (sortCol === "lastSession") {
        cmp = a.lastSession.localeCompare(b.lastSession);
      } else {
        cmp = a[sortCol] - b[sortCol];
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortCol, sortDir]);

  const hasFilters = Object.values(filters).some(Boolean);

  function SortIcon({ col }: { col: SortColumn }) {
    if (sortCol !== col) {
      return <span className="ml-1 text-slate-300 dark:text-slate-600">↕</span>;
    }
    return (
      <span className="ml-1 text-blue-500">
        {sortDir === "asc" ? "↑" : "↓"}
      </span>
    );
  }

  function thClass(align: "left" | "right" = "left") {
    return `px-6 py-3 text-${align} text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-200`;
  }

  function filterInput(col: NumericColumn) {
    return (
      <input
        type="number"
        placeholder="≤"
        value={filters[col] ?? ""}
        onChange={(e) =>
          setFilters((f) => ({ ...f, [col]: e.target.value }))
        }
        onClick={(e) => e.stopPropagation()}
        className="mt-1 w-full text-xs px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 placeholder-slate-300 dark:placeholder-slate-500 font-normal normal-case tracking-normal [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
      {hasFilters && (
        <div className="px-6 pt-3 pb-0 flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {sorted.length} of {rows.length} rows
          </span>
          <button
            onClick={() => setFilters({})}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th
                className={thClass("left")}
                onClick={() => handleSort("name")}
              >
                Name <SortIcon col="name" />
              </th>
              <th
                className={thClass("right")}
                onClick={() => handleSort("sessions")}
              >
                Sessions <SortIcon col="sessions" />
                {filterInput("sessions")}
              </th>
              <th
                className={thClass("right")}
                onClick={() => handleSort("min")}
              >
                Min <SortIcon col="min" />
                {filterInput("min")}
              </th>
              <th
                className={thClass("right")}
                onClick={() => handleSort("median")}
              >
                Median <SortIcon col="median" />
                {filterInput("median")}
              </th>
              <th
                className={thClass("right")}
                onClick={() => handleSort("mean")}
              >
                Mean <SortIcon col="mean" />
                {filterInput("mean")}
              </th>
              <th
                className={thClass("right")}
                onClick={() => handleSort("max")}
              >
                Max <SortIcon col="max" />
                {filterInput("max")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Trend
              </th>
              <th
                className={thClass("left")}
                onClick={() => handleSort("lastSession")}
              >
                Last Session <SortIcon col="lastSession" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {sorted.map((row) => (
              <tr
                key={row.typeId}
                className="hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <td className="px-6 py-4">
                  <Link
                    href={`/admin/insights/prickles/${row.normalizedName}${buildRangeUrl(from, to)}`}
                    className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    {row.typeName}
                  </Link>
                </td>
                <td className="px-6 py-4 text-right text-sm text-slate-900 dark:text-slate-100 tabular-nums">
                  {row.sessions}
                </td>
                <td className="px-6 py-4 text-right text-sm text-slate-700 dark:text-slate-300 tabular-nums">
                  {row.min}
                </td>
                <td className="px-6 py-4 text-right text-sm text-slate-700 dark:text-slate-300 tabular-nums">
                  {row.median % 1 === 0 ? row.median : row.median.toFixed(1)}
                </td>
                <td className="px-6 py-4 text-right text-sm font-medium text-slate-900 dark:text-slate-100 tabular-nums">
                  {row.mean.toFixed(1)}
                </td>
                <td className="px-6 py-4 text-right text-sm text-slate-700 dark:text-slate-300 tabular-nums">
                  {row.max}
                </td>
                <td className="px-6 py-4">
                  <Sparkline values={row.sparkline} />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
                  {new Date(row.lastSession).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sorted.length === 0 && rows.length > 0 && (
        <div className="p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
          No rows match current filters.{" "}
          <button
            onClick={() => setFilters({})}
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
