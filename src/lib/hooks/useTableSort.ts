"use client";

import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

export interface SortConfig<TColumn extends string> {
  column: TColumn;
  direction: SortDirection;
}

// A column's sort key. Dates may be passed as Date objects or as ISO strings
// (date-only "YYYY-MM-DD" or full timestamps) and are compared chronologically.
// null/undefined (and NaN / invalid dates) mean "no value": they sort last
// ascending and first descending (descending is a true reversal).
export type SortValue = string | number | Date | null | undefined;

interface UseTableSortOptions<TRow, TColumn extends string> {
  rows: TRow[];
  getSortValue: (row: TRow, column: TColumn) => SortValue;
  // Sort applied when no column is actively clicked (initial view, and the
  // state a third click on the active column reverts to). Pass null for a
  // table whose "cleared" state is simply the given row order.
  defaultSort?: SortConfig<TColumn> | null;
}

interface UseTableSortResult<TRow, TColumn extends string> {
  sortColumn: TColumn | null;
  sortDirection: SortDirection;
  handleSort: (column: TColumn) => void;
  sortedRows: TRow[];
}

// Tri-state transition: click 1 -> asc, click 2 (same column) -> desc,
// click 3 (same column) -> clear (null). Pure so it's unit-testable without
// mounting the hook.
export function nextSortConfig<TColumn extends string>(
  prev: SortConfig<TColumn> | null,
  column: TColumn
): SortConfig<TColumn> | null {
  if (!prev || prev.column !== column) {
    return { column, direction: "asc" };
  }
  if (prev.direction === "asc") {
    return { column, direction: "desc" };
  }
  return null;
}

// What a header click does, given the active (clicked) sort and the table's
// default. The default sort's column has no distinct "cleared" state —
// clearing would land on the very view already showing — so clicking it just
// flips direction, and clicking it from another column returns to the default
// view. Every other column uses the tri-state cycle in nextSortConfig.
// Returns null to mean "show defaultSort".
export function nextTableSort<TColumn extends string>(
  active: SortConfig<TColumn> | null,
  defaultSort: SortConfig<TColumn> | null,
  column: TColumn
): SortConfig<TColumn> | null {
  if (!defaultSort || defaultSort.column !== column) {
    return nextSortConfig(active, column);
  }
  const current = active ?? defaultSort;
  if (current.column !== column) return null;
  const direction: SortDirection = current.direction === "asc" ? "desc" : "asc";
  return direction === defaultSort.direction ? null : { column, direction };
}

// "YYYY-MM-DD", optionally followed by a time and a Z / ±HH[:MM] offset —
// the shapes Postgres DATE and TIMESTAMPTZ columns come back as.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Epoch ms for an ISO date string, or NaN if it isn't one. Date-only strings
// are read as local midnight (like parseDateOnly), not UTC, so they order
// consistently against same-day local timestamps.
function isoStringToTime(value: string): number {
  if (!ISO_DATE_RE.test(value)) return NaN;
  return DATE_ONLY_RE.test(value) ? new Date(`${value}T00:00:00`).getTime() : Date.parse(value);
}

type PresentSortValue = string | number | Date;

function isMissing(value: SortValue): value is null | undefined {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return Number.isNaN(value);
  if (value instanceof Date) return Number.isNaN(value.getTime());
  return false;
}

function toTime(value: PresentSortValue): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return isoStringToTime(value);
  return value;
}

function compareNumbers(a: number, b: number): number {
  // Not `a - b`: Infinity - Infinity is NaN, which sort() treats as "equal".
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

// Ascending comparison of two present sort values.
function comparePresent(a: PresentSortValue, b: PresentSortValue): number {
  if (typeof a === "number" && typeof b === "number") return compareNumbers(a, b);
  // Dates (Date objects and/or ISO strings) compare chronologically, never
  // lexically — "2024-01-05T09:00:00Z" vs "2024-01-05T10:00:00+02:00" etc.
  const aTime = toTime(a);
  const bTime = toTime(b);
  if (typeof a !== "number" && typeof b !== "number" && !Number.isNaN(aTime) && !Number.isNaN(bTime)) {
    return compareNumbers(aTime, bTime);
  }
  if (typeof a === "number") return -1; // mixed types: numbers first, deterministically
  if (typeof b === "number") return 1;
  return String(a).localeCompare(String(b));
}

// Ascending comparison of any two sort values: missing values rank after
// every present value.
function compareAscending(a: SortValue, b: SortValue): number {
  const aMissing = isMissing(a);
  const bMissing = isMissing(b);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return comparePresent(a, b);
}

// Comparator for one direction. Descending is an exact reversal of ascending,
// so missing values sort last ascending and first descending — clicking both
// directions shows both ends of the column, empties included.
export function compareSortValues(a: SortValue, b: SortValue, direction: SortDirection): number {
  const cmp = compareAscending(a, b);
  if (cmp === 0) return 0;
  return direction === "asc" ? cmp : -cmp;
}

export function sortRows<TRow, TColumn extends string>(
  rows: TRow[],
  getSortValue: (row: TRow, column: TColumn) => SortValue,
  sort: SortConfig<TColumn> | null
): TRow[] {
  if (!sort) return rows;
  const { column, direction } = sort;
  return [...rows].sort((a, b) => compareSortValues(getSortValue(a, column), getSortValue(b, column), direction));
}

// Tri-state column sort: click 1 -> asc, click 2 (same column) -> desc,
// click 3 (same column) -> clear back to defaultSort (or raw row order).
// The defaultSort column itself just toggles direction (see nextTableSort).
export function useTableSort<TRow, TColumn extends string>({
  rows,
  getSortValue,
  defaultSort = null,
}: UseTableSortOptions<TRow, TColumn>): UseTableSortResult<TRow, TColumn> {
  const [activeSort, setActiveSort] = useState<SortConfig<TColumn> | null>(null);

  function handleSort(column: TColumn) {
    setActiveSort((prev) => nextTableSort(prev, defaultSort, column));
  }

  const effectiveSort = activeSort ?? defaultSort;

  // getSortValue is a dependency so a getter that closes over state (e.g. a
  // timezone) re-sorts when it changes; pass a module-level function or a
  // useCallback so it's stable otherwise.
  const sortedRows = useMemo(
    () => sortRows(rows, getSortValue, effectiveSort),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, getSortValue, effectiveSort?.column, effectiveSort?.direction]
  );

  return {
    sortColumn: effectiveSort?.column ?? null,
    sortDirection: effectiveSort?.direction ?? "asc",
    handleSort,
    sortedRows,
  };
}
