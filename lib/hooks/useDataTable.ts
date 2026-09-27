"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  nextTableSort,
  useTableSort,
  type SortConfig,
  type SortDirection,
  type SortValue,
} from "@/lib/hooks/useTableSort";
import { AUTO_PAGINATE_THRESHOLD, DEFAULT_PAGE_SIZE, pageBounds, parseSortParams } from "@/lib/pagination";

// The one building block for data tables: sorting (SortableTh headers) plus
// pagination, so no table decides for itself whether to page.
//
//   const table = useDataTable({ rows, getSortValue, defaultSort });
//   <SortableTh label="Name" {...table.sortProps("name")} />
//   {table.rows.map(...)}
//   <DataTablePager table={table} itemLabel="members" />
//
// Client mode (useDataTable) sorts all rows in memory and auto-paginates once
// there are more than AUTO_PAGINATE_THRESHOLD of them — below that there's no
// pager and every row shows. Server mode (useServerDataTable) takes one page
// the server already sorted and ranged, and keeps sort/page in the URL.

export interface DataTablePagination {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export interface DataTable<TRow, TColumn extends string> {
  sortColumn: TColumn | null;
  sortDirection: SortDirection;
  handleSort: (column: TColumn) => void;
  // Spread into <SortableTh label="..." {...table.sortProps("column")} />.
  sortProps: (column: TColumn) => { active: boolean; direction: SortDirection; onClick: () => void };
  // The rows to render: the current page (or every row when not paginated).
  rows: TRow[];
  // Total row count across all pages.
  total: number;
  // null when everything fits on one page; <DataTablePager> renders nothing then.
  pagination: DataTablePagination | null;
}

function sortPropsFor<TColumn extends string>(
  sortColumn: TColumn | null,
  sortDirection: SortDirection,
  handleSort: (column: TColumn) => void
) {
  return (column: TColumn) => ({
    active: sortColumn === column,
    direction: sortDirection,
    onClick: () => handleSort(column),
  });
}

interface UseDataTableOptions<TRow, TColumn extends string> {
  // Already filtered; sorting and paging happen here.
  rows: TRow[];
  getSortValue: (row: TRow, column: TColumn) => SortValue;
  // Sort shown before any header click (and after a column's third click).
  defaultSort?: SortConfig<TColumn> | null;
  pageSize?: number;
  // "auto" (default): page once rows exceed AUTO_PAGINATE_THRESHOLD.
  // false: never page — only for layouts that can't be split, e.g. rows
  // grouped under day headers or a list another view scrolls into.
  paginate?: "auto" | false;
  // Change this when a filter changes so the table returns to page 1. Sort
  // changes do that on their own.
  resetKey?: string;
  // A row that must be on screen, e.g. one linked from a URL or open by
  // default: whenever the table would reset to page 1 (first render, sort,
  // filter or page-size change, or when `key` or the row itself appears), it
  // goes to the page containing that row instead. Manual paging is left alone.
  reveal?: { key: string | null | undefined; getRowKey: (row: TRow) => string };
}

export function useDataTable<TRow, TColumn extends string>({
  rows,
  getSortValue,
  defaultSort = null,
  pageSize: initialPageSize = DEFAULT_PAGE_SIZE,
  paginate = "auto",
  resetKey = "",
  reveal,
}: UseDataTableOptions<TRow, TColumn>): DataTable<TRow, TColumn> {
  const { sortColumn, sortDirection, handleSort, sortedRows } = useTableSort<TRow, TColumn>({
    rows,
    getSortValue,
    defaultSort,
  });

  const revealIndex = reveal?.key ? sortedRows.findIndex((row) => reveal.getRowKey(row) === reveal.key) : -1;
  // Page 1, or the page holding the revealed row.
  const landingPage = (size: number) => (revealIndex >= 0 ? Math.floor(revealIndex / size) + 1 : 1);

  const fullResetKey = `${sortColumn}:${sortDirection}:${resetKey}:${reveal?.key ?? ""}:${revealIndex >= 0}`;
  const [state, setState] = useState(() => ({
    page: landingPage(initialPageSize),
    pageSize: initialPageSize,
    resetKey: fullResetKey,
  }));
  // Reset during render (not in an effect) so a stale page never paints.
  let { page } = state;
  if (state.resetKey !== fullResetKey) {
    page = landingPage(state.pageSize);
    setState({ ...state, page, resetKey: fullResetKey });
  }

  const paginated = paginate === "auto" && sortedRows.length > AUTO_PAGINATE_THRESHOLD;
  const bounds = pageBounds(page, state.pageSize, sortedRows.length);
  const visibleRows = useMemo(
    () => (paginated ? sortedRows.slice(bounds.offset, bounds.offset + bounds.pageSize) : sortedRows),
    [paginated, sortedRows, bounds.offset, bounds.pageSize]
  );

  return {
    sortColumn,
    sortDirection,
    handleSort,
    sortProps: sortPropsFor(sortColumn, sortDirection, handleSort),
    rows: visibleRows,
    total: sortedRows.length,
    pagination: paginated
      ? {
          page: bounds.page,
          pageSize: bounds.pageSize,
          total: sortedRows.length,
          onPageChange: (next) => setState((s) => ({ ...s, page: next })),
          onPageSizeChange: (next) => setState((s) => ({ ...s, pageSize: next, page: landingPage(next) })),
        }
      : null,
  };
}

interface UseServerDataTableOptions<TRow, TColumn extends string> {
  // The current page, already filtered, sorted and ranged by the server.
  rows: TRow[];
  total: number;
  // What the server actually served (after clamping), from the same URL params.
  page: number;
  pageSize: number;
  // Sortable columns the server accepts (parseSortParams uses the same list).
  allowed: readonly TColumn[];
  defaultSort: SortConfig<TColumn> | null;
}

// Server mode: ?sort=&dir=&page=&pageSize= drive the server component's query
// (read back with lib/pagination's parsers). Header clicks follow the same
// rules as client mode (nextTableSort) and, like any sort change, go to page 1.
export function useServerDataTable<TRow, TColumn extends string>({
  rows,
  total,
  page,
  pageSize,
  allowed,
  defaultSort,
}: UseServerDataTableOptions<TRow, TColumn>): DataTable<TRow, TColumn> {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Only an explicit ?sort= counts as an active (clicked) sort.
  const active = parseSortParams(searchParams.get("sort"), searchParams.get("dir"), allowed, null);
  const effective = active ?? defaultSort;

  function push(update: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    update(params);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const handleSort = (column: TColumn) =>
    push((params) => {
      const next = nextTableSort(active, defaultSort, column);
      if (next) {
        params.set("sort", next.column);
        params.set("dir", next.direction);
      } else {
        params.delete("sort");
        params.delete("dir");
      }
      params.delete("page");
    });

  const sortColumn = effective?.column ?? null;
  const sortDirection = effective?.direction ?? "asc";

  return {
    sortColumn,
    sortDirection,
    handleSort,
    sortProps: sortPropsFor(sortColumn, sortDirection, handleSort),
    rows,
    total,
    pagination:
      total > AUTO_PAGINATE_THRESHOLD || page > 1 || pageSize !== DEFAULT_PAGE_SIZE
        ? {
            page,
            pageSize,
            total,
            onPageChange: (next) =>
              push((params) => {
                if (next <= 1) params.delete("page");
                else params.set("page", String(next));
              }),
            onPageSizeChange: (next) =>
              push((params) => {
                params.set("pageSize", String(next));
                params.delete("page");
              }),
          }
        : null,
  };
}
