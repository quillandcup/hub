// Shared pagination rules. Tables don't use these directly — useDataTable
// (lib/hooks/useDataTable.ts) applies them:
// - Client mode: every row is loaded; the table auto-paginates once it has more
//   than AUTO_PAGINATE_THRESHOLD rows, and shows no pager below that.
// - Server mode: for sources that can pass PostgREST's 1000-row cap or whose
//   cost grows with history (e.g. All Members). The query itself is filtered,
//   ordered and ranged; the server component reads ?sort=&dir=&page=&pageSize=
//   with the parsers below.

import type { SortConfig, SortDirection } from "@/lib/hooks/useTableSort";

export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;
// Keep a single page far below PostgREST's 1000-row limit.
export const MAX_PAGE_SIZE = 100;
// Client-mode tables page only once they have more rows than this.
export const AUTO_PAGINATE_THRESHOLD = DEFAULT_PAGE_SIZE;

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
