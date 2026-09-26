// Shared pagination rules, used on both sides:
// - server-paged tables (the query itself is ranged + ordered; page/sort live
//   in the URL) parse their search params with parsePageParam/parseSortParams
// - client-paged tables (all rows already loaded) slice with usePagination
//
// When to use which:
// - Server-side: the source can exceed PostgREST's 1000-row cap, or loading it
//   costs work proportional to history (e.g. All Members, which aggregated all
//   prickle attendance). Sorting must then happen in the same query.
// - Client-side: the table is bounded and already fully loaded, but can grow
//   past one page (a few hundred rows) — paging keeps the DOM small.
// - None: tables that realistically stay under one page (CLIENT_PAGINATION_THRESHOLD).
//   usePagination/Pagination render no controls until there's a second page,
//   so wiring them into a small table costs nothing.

import type { SortConfig, SortDirection } from "@/lib/hooks/useTableSort";

export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;
// Keep a single page far below PostgREST's 1000-row limit.
export const MAX_PAGE_SIZE = 100;
// Tables whose realistic size stays at or below this don't need paging.
export const CLIENT_PAGINATION_THRESHOLD = DEFAULT_PAGE_SIZE;

type ParamValue = string | string[] | undefined | null;

function first(value: ParamValue): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

export function parsePageParam(value: ParamValue): number {
  const n = Number.parseInt(first(value) ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function parsePageSizeParam(value: ParamValue, fallback: number = DEFAULT_PAGE_SIZE): number {
  const n = Number.parseInt(first(value) ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, MAX_PAGE_SIZE);
}

export interface PageBounds {
  page: number; // clamped to [1, pageCount]
  pageSize: number;
  pageCount: number; // at least 1
  offset: number; // rows to skip
  // 1-based, inclusive, for "Showing 51–100 of 734"; 0/0 when total is 0
  firstItem: number;
  lastItem: number;
}

export function pageBounds(page: number, pageSize: number, total: number): PageBounds {
  const size = Math.max(1, pageSize);
  const pageCount = Math.max(1, Math.ceil(total / size));
  const clamped = Math.min(Math.max(1, page), pageCount);
  const offset = (clamped - 1) * size;
  return {
    page: clamped,
    pageSize: size,
    pageCount,
    offset,
    firstItem: total === 0 ? 0 : offset + 1,
    lastItem: Math.min(offset + size, total),
  };
}

// Reads ?sort=&dir= against a whitelist. Anything unknown falls back to the default.
export function parseSortParams<TColumn extends string>(
  sort: ParamValue,
  dir: ParamValue,
  allowed: readonly TColumn[],
  defaultSort: SortConfig<TColumn> | null
): SortConfig<TColumn> | null {
  const column = first(sort);
  if (!column || !(allowed as readonly string[]).includes(column)) return defaultSort;
  const direction: SortDirection = first(dir) === "desc" ? "desc" : "asc";
  return { column: column as TColumn, direction };
}
