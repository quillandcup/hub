"use client";

import { PAGE_SIZE_OPTIONS, pageBounds } from "@/lib/pagination";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  // Omit to hide the page-size picker.
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  // Plural noun for the summary, e.g. "members" -> "Showing 1–50 of 734 members".
  itemLabel?: string;
}

const BUTTON_CLASS =
  "px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent";

// Standard table footer: "Showing 51–100 of 734", Prev/Next, page-size picker.
// Renders nothing while everything fits on one page at the smallest page size,
// so it can be dropped under any table unconditionally.
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  itemLabel = "rows",
}: PaginationProps) {
  const smallestSize = Math.min(pageSize, ...pageSizeOptions);
  if (total <= smallestSize) return null;

  const bounds = pageBounds(page, pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-t border-slate-200 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400"
    >
      <span>
        Showing {bounds.firstItem.toLocaleString()}–{bounds.lastItem.toLocaleString()} of {total.toLocaleString()}{" "}
        {itemLabel}
      </span>
      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5">
            <span>Per page</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="px-2 py-1 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={() => onPageChange(bounds.page - 1)}
          disabled={bounds.page <= 1}
        >
          ← Prev
        </button>
        <span aria-current="page">
          Page {bounds.page} of {bounds.pageCount}
        </span>
        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={() => onPageChange(bounds.page + 1)}
          disabled={bounds.page >= bounds.pageCount}
        >
          Next →
        </button>
      </div>
    </nav>
  );
}
