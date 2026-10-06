"use client";

import { useState } from "react";

export interface SearchItem {
  id: string;
  name: string;
  /** Second line under the name, e.g. an email or a role. Also searched. */
  detail?: string | null;
}

interface EntitySearchProps {
  items: SearchItem[];
  selectedId: string | null;
  /** Shown when the selected id isn't in `items` (e.g. loaded separately). */
  selectedName?: string | null;
  onSelect: (item: SearchItem | null) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Reusable single-select search/autocomplete: shows the selection with a clear
 * button, or a search input with a dropdown of matches. MemberSearch and
 * StaffSearch are thin wrappers that feed it members / staff.
 */
export default function EntitySearch({
  items,
  selectedId,
  selectedName,
  onSelect,
  placeholder = "Search...",
  className = "",
}: EntitySearchProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const selected = selectedId ? items.find((i) => i.id === selectedId) : null;
  const displayName = selected?.name || selectedName;

  const needle = searchTerm.toLowerCase();
  const matches = searchTerm
    ? items
        .filter((i) => i.name.toLowerCase().includes(needle) || i.detail?.toLowerCase().includes(needle))
        .slice(0, 10)
    : [];

  const showDropdown = isFocused && matches.length > 0;

  function handleSelect(item: SearchItem | null) {
    onSelect(item);
    setSearchTerm("");
    setIsFocused(false);
  }

  return (
    <div className={`relative ${className}`}>
      {displayName && !isFocused ? (
        <div className="flex items-center justify-between px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-sm text-slate-900 dark:text-slate-100">
          <span className="flex-1 truncate">{displayName}</span>
          <button
            type="button"
            onClick={() => handleSelect(null)}
            className="ml-2 text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
            title="Clear selection"
          >
            ✕
          </button>
        </div>
      ) : (
        <>
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
                  onClick={() => handleSelect(item)}
                  className="w-full px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-slate-700 border-b border-slate-100 dark:border-slate-700 last:border-b-0"
                >
                  <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">{item.name}</div>
                  {item.detail && <div className="text-xs text-gray-600 dark:text-slate-400">{item.detail}</div>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
