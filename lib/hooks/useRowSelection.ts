import { useCallback, useMemo, useState } from "react";

export interface RowSelection {
  selectedIds: Set<string>;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Selects every row, or clears them all when every row is already selected. */
  toggleAll: () => void;
  clear: () => void;
  allSelected: boolean;
  /** Some but not all selected: the header checkbox's indeterminate state. */
  someSelected: boolean;
}

/**
 * Multi-select for a table's current rows, for bulk actions. `rowIds` are the ids on screen (one
 * page, in server mode); selections of rows that have left the page are dropped, so a bulk action
 * never touches something the member can't see.
 */
export function useRowSelection(rowIds: string[]): RowSelection {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const onPage = useMemo(() => new Set(rowIds), [rowIds]);
  const selectedIds = useMemo(() => new Set([...picked].filter((id) => onPage.has(id))), [picked, onPage]);

  const toggle = useCallback((id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = rowIds.length > 0 && selectedIds.size === rowIds.length;
  const toggleAll = useCallback(() => setPicked(allSelected ? new Set() : new Set(rowIds)), [allSelected, rowIds]);
  const clear = useCallback(() => setPicked(new Set()), []);

  return {
    selectedIds,
    isSelected: (id) => selectedIds.has(id),
    toggle,
    toggleAll,
    clear,
    allSelected,
    someSelected: selectedIds.size > 0 && !allSelected,
  };
}
