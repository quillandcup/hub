"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { nextTableSort, type SortConfig, type SortDirection } from "@/lib/hooks/useTableSort";
import { DEFAULT_PAGE_SIZE, parsePageParam, parsePageSizeParam, parseSortParams } from "@/lib/pagination";

// URL-backed sort + page state for server-paged tables: the server component
// reads the same ?sort=&dir=&page=&pageSize= params (via lib/pagination) and
// runs one ranged, ordered query. Header clicks follow the same rules as
// useTableSort (nextTableSort), and any sort change returns to page 1.
export function useUrlTableState<TColumn extends string>({
  allowed,
  defaultSort,
  defaultPageSize = DEFAULT_PAGE_SIZE,
}: {
  allowed: readonly TColumn[];
  defaultSort: SortConfig<TColumn> | null;
  defaultPageSize?: number;
}): {
  sortColumn: TColumn | null;
  sortDirection: SortDirection;
  handleSort: (column: TColumn) => void;
  page: number;
  pageSize: number;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Only an explicit ?sort= counts as an "active" (clicked) sort.
  const active = parseSortParams(searchParams.get("sort"), searchParams.get("dir"), allowed, null);
  const effective = active ?? defaultSort;

  function push(update: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    update(params);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return {
    sortColumn: effective?.column ?? null,
    sortDirection: effective?.direction ?? "asc",
    handleSort: (column) =>
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
      }),
    page: parsePageParam(searchParams.get("page")),
    pageSize: parsePageSizeParam(searchParams.get("pageSize"), defaultPageSize),
    setPage: (page) =>
      push((params) => {
        if (page <= 1) params.delete("page");
        else params.set("page", String(page));
      }),
    setPageSize: (pageSize) =>
      push((params) => {
        params.set("pageSize", String(pageSize));
        params.delete("page");
      }),
  };
}
