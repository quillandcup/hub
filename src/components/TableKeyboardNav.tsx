"use client";

import { createContext, useContext, useId, useRef, type ReactNode } from "react";
import Kbd from "@/components/Kbd";
import { useRegisterShortcuts } from "@/components/shortcuts/ShortcutsProvider";
import { useTableKeyboardNav } from "@/lib/hooks/useTableKeyboardNav";
import type { DataTable } from "@/lib/hooks/useDataTable";

/**
 * Keyboard row navigation for any table, wrapped around the table and its pager:
 *
 *   <TableKeyboardNav table={table} label="Members">
 *     <div className="overflow-x-auto"><table>...</table></div>
 *     <DataTablePager table={table} itemLabel="members" />
 *   </TableKeyboardNav>
 *
 * Focus model. The region is one tab stop (`tabIndex` 0, a ring while it has keyboard focus). The highlighted row
 * is marked `data-kbd-active` (a calm plum tint and a bar on its left edge, light and dark) and named by
 * `aria-activedescendant` on the region; the table's own markup is untouched, and a polite live region reads
 * "<row text>, row 3 of 25" (and "selected" / "not selected") as it moves. Keys work while focus is anywhere in the
 * region, except that Enter and Space stay with a focused link, button or checkbox. When nothing has focus and the
 * page has exactly one table with rows, j/k start the highlight at the first/last row and move focus into the
 * region (Gmail style). The highlight returns to the first row when the page, page size or sort changes. Single
 * letters are ignored while typing, with a dialog, menu or open combobox on screen, and with Ctrl/Cmd/Alt held.
 *
 * Rows opt in by what they hold: an `a[href]` (or an element, or the `tr` itself, marked `data-row-primary`) is
 * what Enter opens; a checkbox is what Space toggles; Shift+j/k and Shift+arrows extend a checked range. Mark a
 * `tr` that is not a data row (a detail row) `data-kbd-skip`. A page that has its own single-key shortcuts says so
 * with `data-page-keys` (see `CalendarKeyboardNav`), which turns the Gmail-style start off there.
 */

/** Every shortcut of a table, one per chord, for the shortcut panel to list. `needs` is what the table must have. */
export const TABLE_KEYBOARD_SHORTCUTS: ReadonlyArray<{ keys: string[]; label: string; needs?: "open" | "select" | "paging" }> = [
  { keys: ["j"], label: "Next row" },
  { keys: ["k"], label: "Previous row" },
  { keys: ["down"], label: "Next row" },
  { keys: ["up"], label: "Previous row" },
  { keys: ["Home"], label: "First row" },
  { keys: ["End"], label: "Last row" },
  { keys: ["enter"], label: "Open the row", needs: "open" },
  { keys: ["space"], label: "Select or unselect the row", needs: "select" },
  { keys: ["shift", "j"], label: "Extend the selection down", needs: "select" },
  { keys: ["shift", "k"], label: "Extend the selection up", needs: "select" },
  { keys: ["["], label: "Previous page", needs: "paging" },
  { keys: ["]"], label: "Next page", needs: "paging" },
];

/** The hint line under a table: the keys of a group on one line, shown only for what this table can do. */
const TABLE_KEYBOARD_HINTS: ReadonlyArray<{ keys: string[]; label: string; needs?: "open" | "select" | "paging" }> = [
  { keys: ["j", "k"], label: "move" },
  { keys: ["enter"], label: "open", needs: "open" },
  { keys: ["space"], label: "select", needs: "select" },
  { keys: ["[", "]"], label: "page", needs: "paging" },
];

const TablePageKeysContext = createContext(false);

/** True inside a `TableKeyboardNav` whose table has more than one page: the pager shows `[` and `]` on its buttons. */
export function useTablePageKeysHint(): boolean {
  return useContext(TablePageKeysContext);
}

// The highlighted row: a tint on its cells (they carry the row's background) and a bar on its first cell.
const ACTIVE_ROW_CLASS =
  "[&_tr[data-kbd-active=true]>*]:bg-plum-50 dark:[&_tr[data-kbd-active=true]>*]:bg-plum-950/40 " +
  "[&_tr[data-kbd-active=true]>*:first-child]:shadow-[inset_3px_0_0_0_theme(colors.plum.500)]";

export default function TableKeyboardNav({
  table,
  label,
  children,
  className = "",
}: {
  // Only the pager and the sort are read (for `[` / `]` and to reset the highlight).
  table: Pick<DataTable<unknown, string>, "pagination" | "sortColumn" | "sortDirection">;
  // What the table lists, for screen readers: "Members".
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const regionRef = useRef<HTMLDivElement>(null);
  const descriptionId = useId();
  const { pagination } = table;
  const { capabilities, announcement } = useTableKeyboardNav({
    regionRef,
    pagination,
    resetKey: `${pagination?.page}:${pagination?.pageSize}:${table.sortColumn}:${table.sortDirection}`,
  });
  // The shortcut panel lists the table keys while a table with rows is on the page, and the optional ones this table can do.
  useRegisterShortcuts("table", {
    active: capabilities.rows > 0,
    has: (["open", "select", "paging"] as const).filter((need) => capabilities[need]),
  });
  const available = (needs?: "open" | "select" | "paging") => !needs || capabilities[needs];
  const hints = TABLE_KEYBOARD_HINTS.filter((hint) => available(hint.needs));

  return (
    <TablePageKeysContext.Provider value={capabilities.paging}>
      <div
        ref={regionRef}
        data-kbd-region
        role="group"
        aria-label={label}
        aria-describedby={descriptionId}
        tabIndex={0}
        className={`${ACTIVE_ROW_CLASS} rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-plum-500 ${className}`}
      >
        {children}
        {capabilities.rows > 0 && (
          <div className="hidden fine-pointer:sm:flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-2 text-xs text-slate-600 dark:text-slate-400">
            {hints.map((hint) => (
              <span key={hint.label} className="inline-flex items-center gap-1.5">
                <span className="inline-flex items-center gap-0.5">
                  {hint.keys.map((key) => (
                    <Kbd key={key} keys={[key]} />
                  ))}
                </span>
                {hint.label}
              </span>
            ))}
          </div>
        )}
        <span id={descriptionId} className="sr-only">
          Use j and k or the arrow keys to move between rows
          {capabilities.open ? ", Enter to open a row" : ""}
          {capabilities.select ? ", Space to select it" : ""}
          {capabilities.paging ? ", left and right square brackets for the previous and next page" : ""}.
        </span>
        <div aria-live="polite" aria-atomic="true" data-kbd-announcer className="sr-only">
          {announcement}
        </div>
      </div>
    </TablePageKeysContext.Provider>
  );
}
