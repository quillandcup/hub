"use client";

import { useState } from "react";
import type { SearchItem } from "@/components/EntitySearch";

interface MultiEntitySearchProps {
  items: SearchItem[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  className?: string;
  /**
   * Show a chip (labelled with the id) for a selected id that isn't in `items`, e.g. a value that
   * has since been removed. Off: such ids are skipped.
   */
  showUnknown?: boolean;
  /** Optional note on a chip, e.g. flagging a selected value that's no longer offered; also turns the chip amber. */
  chipNote?: (id: string) => string | undefined;
}

/**
 * Multi-select counterpart of EntitySearch: selected items show as removable chips above a search
 * input whose dropdown lists unselected matches. MultiMemberSearch and MultiSelectSearch are thin
 * wrappers that feed it members / plain strings.
 */
export default function MultiEntitySearch({
  items,
  selectedIds,
  onChange,
  placeholder = "Search...",
  className = "",
  showUnknown = false,
  chipNote,
}: MultiEntitySearchProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const chips = selectedIds
    .map((id) => ({ id, name: items.find((i) => i.id === id)?.name ?? (showUnknown ? id : null) }))
    .filter((c): c is { id: string; name: string } => c.name !== null);

  const needle = searchTerm.toLowerCase();
  const matches = searchTerm
    ? items
        .filter(
          (i) =>
            !selectedIds.includes(i.id) && (i.name.toLowerCase().includes(needle) || i.detail?.toLowerCase().includes(needle))
        )
        .slice(0, 10)
    : [];

  const showDropdown = isFocused && matches.length > 0;

  function add(id: string) {
    onChange([...selectedIds, id]);
    setSearchTerm("");
  }

  function remove(id: string) {
    onChange(selectedIds.filter((v) => v !== id));
  }

  return (
    <div className={className}>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {chips.map(({ id, name }) => {
            const note = chipNote?.(id);
            return (
              <span
                key={id}
                className={
                  note
                    ? "inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded-full text-sm"
                    : "inline-flex items-center gap-1.5 px-3 py-1 bg-plum-50 dark:bg-plum-900/30 text-plum-700 dark:text-plum-300 rounded-full text-sm"
                }
              >
                {name}
                {note && <span className="text-xs">{note}</span>}
                <button
                  type="button"
                  onClick={() => remove(id)}
                  className={
                    note
                      ? "text-amber-500 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-200"
                      : "text-plum-400 hover:text-plum-600 dark:text-plum-500 dark:hover:text-plum-300"
                  }
                  title={`Remove ${name}`}
                >
                  ✕
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="relative">
        <input
          type="text"
          placeholder={placeholder}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-plum-500"
        />
        {showDropdown && (
          <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
            {matches.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => add(item.id)}
                className="w-full px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-slate-700 border-b border-slate-100 dark:border-slate-700 last:border-b-0"
              >
                <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">{item.name}</div>
                {item.detail && <div className="text-xs text-gray-600 dark:text-slate-400">{item.detail}</div>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
