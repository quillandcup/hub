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

const DEFAULT_CELL_CLASS = "px-6 py-3 text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider";

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
  // The whole header cell stays clickable for the mouse (the click on the th), and the label is a real button so Tab
  // reaches it and Enter or Space press it: a button's keyboard press is a click that bubbles to the th, so there is
  // one handler and it runs once. `aria-sort` on the th tells a screen reader which way the column is ordered.
  return (
    <th
      className={`${className} text-${align} cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-200`}
      onClick={onClick}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className="rounded-sm [font:inherit] [letter-spacing:inherit] [text-align:inherit] [text-transform:inherit] focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500"
      >
        {label} <SortIcon active={active} direction={direction} />
      </button>
      {filter}
    </th>
  );
}
