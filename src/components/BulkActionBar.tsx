"use client";

import type { ReactNode } from "react";

/**
 * The strip above a table while rows are selected: "N selected", the table's bulk actions
 * (buttons passed as children) and a Clear. Renders nothing with no selection.
 */
export function BulkActionBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="flex items-center gap-4 border-b border-plum-200 bg-plum-50 px-6 py-3 dark:border-plum-800 dark:bg-plum-950/30"
    >
      <span className="text-sm font-medium text-plum-800 dark:text-plum-300">{count} selected</span>
      {children}
      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-sm text-plum-600 hover:underline dark:text-plum-400"
      >
        Clear
      </button>
    </div>
  );
}

/** A bulk action button in the BulkActionBar's look. */
export function BulkActionButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg bg-plum-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-plum-700"
    >
      {children}
    </button>
  );
}
