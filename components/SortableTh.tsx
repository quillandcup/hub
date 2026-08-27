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
  return <span className="ml-1 text-blue-500">{direction === "asc" ? "↑" : "↓"}</span>;
}

interface SortableThProps {
  label: ReactNode;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
  align?: "left" | "right";
  // Extra content rendered below the label, e.g. a per-column filter input.
  filter?: ReactNode;
}

export function SortableTh({ label, active, direction, onClick, align = "left", filter }: SortableThProps) {
  return (
    <th
      className={`px-6 py-3 text-${align} text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-200`}
      onClick={onClick}
    >
      {label} <SortIcon active={active} direction={direction} />
      {filter}
    </th>
  );
}
