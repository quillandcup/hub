"use client";

import { Pagination } from "@/components/Pagination";
import type { DataTable } from "@/lib/hooks/useDataTable";

// Footer for any useDataTable/useServerDataTable table. Always render it;
// it shows nothing until the table actually has more than one page.
export function DataTablePager<TRow, TColumn extends string>({
  table,
  itemLabel,
}: {
  table: DataTable<TRow, TColumn>;
  // Plural noun, e.g. "members" -> "Showing 1–50 of 734 members".
  itemLabel?: string;
}) {
  if (!table.pagination) return null;
  return <Pagination {...table.pagination} itemLabel={itemLabel} />;
}
