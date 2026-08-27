"use client";

import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

export interface SortConfig<TColumn extends string> {
  column: TColumn;
  direction: SortDirection;
}

interface UseTableSortOptions<TRow, TColumn extends string> {
  rows: TRow[];
  getSortValue: (row: TRow, column: TColumn) => string | number;
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

// Tri-state column sort: click 1 -> asc, click 2 (same column) -> desc,
// click 3 (same column) -> clear back to defaultSort (or raw row order).
export function useTableSort<TRow, TColumn extends string>({
  rows,
  getSortValue,
  defaultSort = null,
}: UseTableSortOptions<TRow, TColumn>): UseTableSortResult<TRow, TColumn> {
  const [activeSort, setActiveSort] = useState<SortConfig<TColumn> | null>(null);

  function handleSort(column: TColumn) {
    setActiveSort((prev) => {
      if (!prev || prev.column !== column) {
        return { column, direction: "asc" };
      }
      if (prev.direction === "asc") {
        return { column, direction: "desc" };
      }
      return null;
    });
  }

  const effectiveSort = activeSort ?? defaultSort;

  const sortedRows = useMemo(() => {
    if (!effectiveSort) return rows;
    const { column, direction } = effectiveSort;
    return [...rows].sort((a, b) => {
      const aVal = getSortValue(a, column);
      const bVal = getSortValue(b, column);
      const cmp =
        typeof aVal === "string" && typeof bVal === "string"
          ? aVal.localeCompare(bVal)
          : (aVal as number) - (bVal as number);
      return direction === "asc" ? cmp : -cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, effectiveSort?.column, effectiveSort?.direction]);

  return {
    sortColumn: effectiveSort?.column ?? null,
    sortDirection: effectiveSort?.direction ?? "asc",
    handleSort,
    sortedRows,
  };
}
