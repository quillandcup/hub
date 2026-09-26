"use client";

import { useMemo, useState } from "react";
import { DEFAULT_PAGE_SIZE, pageBounds, type PageBounds } from "@/lib/pagination";

interface UsePaginationOptions<TRow> {
  // Rows in display order — pass useTableSort's sortedRows so sorting applies
  // across all pages, not just within the current one.
  rows: TRow[];
  pageSize?: number;
  // Changing this (e.g. `${sortColumn}:${sortDirection}:${filter}`) jumps back
  // to page 1, so a new sort or filter doesn't leave you on page 7.
  resetKey?: string;
}

export interface UsePaginationResult<TRow> extends PageBounds {
  pageRows: TRow[];
  total: number;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  // Spread into <Pagination {...paginationProps} itemLabel="..." />.
  paginationProps: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
  };
}

// Client-side paging for tables whose rows are already loaded.
export function usePagination<TRow>({
  rows,
  pageSize: initialPageSize = DEFAULT_PAGE_SIZE,
  resetKey = "",
}: UsePaginationOptions<TRow>): UsePaginationResult<TRow> {
  const [state, setState] = useState({ page: 1, pageSize: initialPageSize, resetKey });

  // Reset during render (not in an effect) so the stale page never paints.
  let { page } = state;
  if (state.resetKey !== resetKey) {
    page = 1;
    setState({ ...state, page: 1, resetKey });
  }

  const bounds = pageBounds(page, state.pageSize, rows.length);
  const pageRows = useMemo(
    () => rows.slice(bounds.offset, bounds.offset + bounds.pageSize),
    [rows, bounds.offset, bounds.pageSize]
  );
  const setPage = (next: number) => setState((s) => ({ ...s, page: next }));
  const setPageSize = (next: number) => setState((s) => ({ ...s, pageSize: next, page: 1 }));

  return {
    ...bounds,
    pageRows,
    total: rows.length,
    setPage,
    setPageSize,
    paginationProps: {
      page: bounds.page,
      pageSize: bounds.pageSize,
      total: rows.length,
      onPageChange: setPage,
      onPageSizeChange: setPageSize,
    },
  };
}
