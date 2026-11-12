"use client";

import type { DataTable } from "@/lib/hooks/useDataTable";

// The search box of any useDataTable table that was given `search`. Render it above the
// table, beside the table's own filters; it shows nothing for a table without search.
export function DataTableSearch<TRow, TColumn extends string>({
  table,
  label,
  className = "w-full max-w-sm",
}: {
  table: DataTable<TRow, TColumn>;
  // What is searched, for the placeholder and screen readers, e.g. "Search offers".
  label: string;
  className?: string;
}) {
  if (!table.search) return null;
  return (
    <input
      type="search"
      value={table.search.query}
      onChange={(e) => table.search?.onChange(e.target.value)}
      placeholder={label}
      aria-label={label}
      className={`${className} rounded border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100`}
    />
  );
}
