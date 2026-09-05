"use client";

import { useState } from "react";

interface MultiSelectSearchProps {
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  className?: string;
  /** Optional note shown on a chip, e.g. flagging a selected value that's no longer in `options`. */
  chipNote?: (value: string) => string | undefined;
}

/** Generic string variant of MultiMemberSearch — selected values show as removable chips. */
export default function MultiSelectSearch({
  options,
  selected,
  onChange,
  placeholder = "Search...",
  className = "",
  chipNote,
}: MultiSelectSearchProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const filteredOptions = searchTerm
    ? options
        .filter((o) => !selected.includes(o) && o.toLowerCase().includes(searchTerm.toLowerCase()))
        .slice(0, 10)
    : [];

  const showDropdown = isFocused && filteredOptions.length > 0;

  function add(value: string) {
    onChange([...selected, value]);
    setSearchTerm("");
  }

  function remove(value: string) {
    onChange(selected.filter((v) => v !== value));
  }

  return (
    <div className={className}>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selected.map((value) => {
            const note = chipNote?.(value);
            return (
              <span
                key={value}
                className={
                  note
                    ? "inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded-full text-sm"
                    : "inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm"
                }
              >
                {value}
                {note && <span className="text-xs">{note}</span>}
                <button
                  type="button"
                  onClick={() => remove(value)}
                  className={
                    note
                      ? "text-amber-500 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-200"
                      : "text-blue-400 hover:text-blue-600 dark:text-blue-500 dark:hover:text-blue-300"
                  }
                  title={`Remove ${value}`}
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
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {showDropdown && (
          <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
            {filteredOptions.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => add(value)}
                className="w-full px-3 py-2 text-left text-sm text-slate-900 dark:text-slate-100 hover:bg-gray-100 dark:hover:bg-slate-700 border-b border-slate-100 dark:border-slate-700 last:border-b-0"
              >
                {value}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
