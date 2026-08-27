"use client";

import { useState, useMemo, Fragment, useEffect, useRef } from "react";
import Link from "next/link";
import type { GroupStats, PrickleSession } from "@/lib/scheduled-prickle-stats";
import { SortableTh } from "@/components/SortableTh";
import { useTableSort } from "@/lib/hooks/useTableSort";

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
// Session detail panel
// ---------------------------------------------------------------------------

function SessionList({ sessions }: { sessions: PrickleSession[] }) {
  const reversed = [...sessions].reverse();
  return (
    <tr>
      <td colSpan={8} className="px-0 py-0 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
        <div className="px-8 py-4 space-y-3">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""} — most recent first
          </p>
          <div className="grid gap-2">
            {reversed.map((s) => (
              <div
                key={s.id}
                className="flex gap-4 text-sm bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700 px-4 py-2.5"
              >
                <div className="shrink-0 w-32 text-xs pt-0.5">
                  <Link
                    href={`/admin/prickles/${s.id}`}
                    className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                  >
                    {new Date(s.startTime).toLocaleDateString(undefined, {
                      weekday: "short",
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </Link>
                </div>
                <div className="flex-1 min-w-0">
                  {s.hostName && (
                    <div className="mb-1">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400 mr-1">
                        Host:
                      </span>
                      <span className="text-slate-700 dark:text-slate-200 font-medium">
                        {s.hostName}
                      </span>
                    </div>
                  )}
                  {s.attendeeCount === 0 ? (
                    <p className="text-slate-400 dark:text-slate-500 text-xs italic">
                      No attendance recorded
                    </p>
                  ) : (
                    <p className="text-slate-700 dark:text-slate-200 leading-relaxed">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400 mr-1">
                        {s.attendeeCount} attended:
                      </span>
                      {s.attendeeNames.join(", ")}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NumericColumn = "sessions" | "min" | "median" | "mean" | "max";
type SortColumn = NumericColumn | "lastSession" | "name";

interface Props {
  rows: GroupStats[];
  groupBy: "schedule" | "host";
  defaultExpanded?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function getSortValue(row: GroupStats, column: SortColumn): string | number {
  if (column === "name") return row.groupKey;
  if (column === "lastSession") return row.lastSession;
  return row[column];
}

export default function GroupedTable({ rows, groupBy, defaultExpanded }: Props) {
  const [filters, setFilters] = useState<Partial<Record<NumericColumn, string>>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    defaultExpanded ? new Set([defaultExpanded]) : new Set()
  );
  const defaultExpandedRowRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    if (!defaultExpanded || !defaultExpandedRowRef.current) return;
    const el = defaultExpandedRowRef.current;
    setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
  }, [defaultExpanded]);

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
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

  const {
    sortColumn,
    sortDirection,
    handleSort,
    sortedRows: sorted,
  } = useTableSort<GroupStats, SortColumn>({
    rows: filtered,
    getSortValue,
    defaultSort: { column: "name", direction: "asc" },
  });

  const hasFilters = Object.values(filters).some(Boolean);

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

  const columnLabel = groupBy === "schedule" ? "Schedule Slot" : "Host";

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
              <th className="px-6 py-3 w-6" aria-label="Expand" />
              <SortableTh
                label={columnLabel}
                align="left"
                active={sortColumn === "name"}
                direction={sortDirection}
                onClick={() => handleSort("name")}
              />
              <SortableTh
                label="Sessions"
                align="right"
                active={sortColumn === "sessions"}
                direction={sortDirection}
                onClick={() => handleSort("sessions")}
                filter={filterInput("sessions")}
              />
              <SortableTh
                label="Min"
                align="right"
                active={sortColumn === "min"}
                direction={sortDirection}
                onClick={() => handleSort("min")}
                filter={filterInput("min")}
              />
              <SortableTh
                label="Median"
                align="right"
                active={sortColumn === "median"}
                direction={sortDirection}
                onClick={() => handleSort("median")}
                filter={filterInput("median")}
              />
              <SortableTh
                label="Mean"
                align="right"
                active={sortColumn === "mean"}
                direction={sortDirection}
                onClick={() => handleSort("mean")}
                filter={filterInput("mean")}
              />
              <SortableTh
                label="Max"
                align="right"
                active={sortColumn === "max"}
                direction={sortDirection}
                onClick={() => handleSort("max")}
                filter={filterInput("max")}
              />
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Trend
              </th>
              <SortableTh
                label="Last Session"
                align="left"
                active={sortColumn === "lastSession"}
                direction={sortDirection}
                onClick={() => handleSort("lastSession")}
              />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {sorted.map((row) => {
              const isExpanded = expanded.has(row.groupKey);
              return (
                <Fragment key={row.groupKey}>
                  <tr
                    ref={row.groupKey === defaultExpanded ? defaultExpandedRowRef : null}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                    onClick={() => toggleExpand(row.groupKey)}
                  >
                    <td className="pl-4 pr-2 py-4 text-slate-400 dark:text-slate-500 text-sm w-6">
                      <span className="inline-block transition-transform duration-150" style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>
                        ▶
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-slate-100">
                      {row.groupLabel}
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
                  {isExpanded && (
                    <SessionList sessions={row.prickleSessions} />
                  )}
                </Fragment>
              );
            })}
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
