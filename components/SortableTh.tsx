"use client";

import type { ReactNode } from "react";
import type { SortDirection } from "@/lib/hooks/useTableSort";

interface SortIconProps {
  active: boolean;
  direction: SortDirection;
}

function SortIcon({ active, direction }: SortIconProps) {
  if (!active) {
    return <span className="ml-1 text-slate-300 dark:text-slate-600">↕</span>;
  }
  return <span className="ml-1 text-plum-500">{direction === "asc" ? "↑" : "↓"}</span>;
}

const DEFAULT_CELL_CLASS = "px-6 py-3 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider";

interface SortableThProps {
  label: ReactNode;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
  align?: "left" | "right" | "center";
  // Extra content rendered below the label, e.g. a per-column filter input.
  filter?: ReactNode;
  // Replaces the default padding/typography classes, for tables whose header
  // style differs from the standard admin table (compact member tables, etc.).
  className?: string;
}

export function SortableTh({
  label,
  active,
  direction,
  onClick,
  align = "left",
  filter,
  className = DEFAULT_CELL_CLASS,
}: SortableThProps) {
  return (
    <th
      className={`${className} text-${align} cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-200`}
      onClick={onClick}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      {label} <SortIcon active={active} direction={direction} />
      {filter}
    </th>
  );
}
