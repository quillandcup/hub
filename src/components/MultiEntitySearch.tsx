"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBelow } from "@/lib/hooks/useBelow";
import { useBlurDelay } from "@/lib/hooks/useBlurDelay";
import { KeyHints, type SearchItem } from "@/components/EntitySearch";
import { useComboboxKeys } from "@/lib/hooks/useComboboxKeys";
import { submitFormOnModEnter } from "@/lib/submit-form-on-mod-enter";
import { useRegisterShortcuts } from "@/components/shortcuts/ShortcutsProvider";
import Tooltip from "@/components/Tooltip";

interface MultiEntitySearchProps {
  items: SearchItem[];
  /** The input's accessible name; defaults to the placeholder. */
  ariaLabel?: string;
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
  ariaLabel,
  selectedIds,
  onChange,
  placeholder = "Search...",
  className = "",
  showUnknown = false,
  chipNote,
}: MultiEntitySearchProps) {
  // The picker's keys are listed in the `?` panel while one is on the page.
  useRegisterShortcuts("pickers");
  const [searchTerm, setSearchTerm] = useState("");
  const { isFocused, setIsFocused, onFocus, onBlur } = useBlurDelay();

  const chips = selectedIds
    .map((id) => ({ id, name: items.find((i) => i.id === id)?.name ?? (showUnknown ? id : null) }))
    .filter((c): c is { id: string; name: string } => c.name !== null);

  // Chosen items stay in the list, marked, so Enter or a click on one takes it off again.
  const needle = searchTerm.toLowerCase();
  const matches = searchTerm
    ? items.filter((i) => i.name.toLowerCase().includes(needle) || i.detail?.toLowerCase().includes(needle)).slice(0, 10)
    : [];

  // Escape closes the list without touching the typed text; typing, focusing or an arrow key brings it back.
  const [dismissed, setDismissed] = useState(false);
  const hasList = matches.length > 0;
  const showDropdown = isFocused && !dismissed && hasList;
  const inputRef = useRef<HTMLInputElement>(null);
  const below = useBelow(inputRef, showDropdown);

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((v) => v !== id) : [...selectedIds, id]);
  }

  function remove(id: string) {
    onChange(selectedIds.filter((v) => v !== id));
  }

  // Enter belongs to the surrounding form until an option is highlighted (`pickSole: false`); a pick toggles and
  // the list stays open, so several can be chosen in a row.
  const combobox = useComboboxKeys({
    count: showDropdown ? matches.length : 0,
    options: searchTerm,
    homeEnd: true,
    pickSole: false,
    keepHighlight: true,
    onPick: (i) => toggle(matches[i].id),
    onEscape: () => {
      if (!showDropdown) return false;
      setDismissed(true);
      return true;
    },
  });

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (submitFormOnModEnter(e)) return;
    if (e.nativeEvent.isComposing) return;
    if (dismissed && hasList && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setDismissed(false);
      return;
    }
    if (combobox.handleKey(e)) return;
    // Backspace in the empty box takes the last chip off, as in a tag box.
    if (e.key === "Backspace" && !searchTerm && chips.length > 0) {
      e.preventDefault();
      remove(chips[chips.length - 1].id);
    }
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
                <Tooltip content={`Remove ${name}`}>
                  <button data-track="multi-entity-search-remove"
                    type="button"
                    aria-label={`Remove ${name}`}
                    onClick={() => remove(id)}
                    className={
                      note
                        ? "text-amber-500 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-200"
                        : "text-plum-400 hover:text-plum-600 dark:text-plum-500 dark:hover:text-plum-300"
                    }
                  >
                    ✕
                  </button>
                </Tooltip>
              </span>
            );
          })}
        </div>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setDismissed(false);
            combobox.reset();
          }}
          onFocus={() => {
            setDismissed(false);
            onFocus();
          }}
          onBlur={onBlur}
          aria-label={ariaLabel ?? placeholder}
          {...combobox.inputProps(showDropdown)}
          onKeyDown={onKeyDown}
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-plum-500"
        />
        {showDropdown && below && createPortal(
          <div
            data-track-no-text
            data-entity-search-list
            style={{ top: below.top, left: below.left, width: below.width }}
            // Keeps focus in the box when the footer is clicked.
            onMouseDown={(e) => e.preventDefault()}
            className="fixed z-overlay bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
            <ul {...combobox.listboxProps} aria-multiselectable="true">
              {matches.map((item, i) => {
                const chosen = selectedIds.includes(item.id);
                return (
                  <li
                    data-track="multi-entity-search-pick"
                    key={item.id}
                    {...combobox.optionProps(i)}
                    aria-selected={chosen}
                    onClick={() => toggle(item.id)}
                    className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-left border-b border-slate-100 dark:border-slate-700 last:border-b-0 ${
                      i === combobox.activeIndex ? "bg-gray-100 dark:bg-slate-700" : "hover:bg-gray-100 dark:hover:bg-slate-700"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">{item.name}</div>
                      {item.detail && <div className="text-xs text-gray-600 dark:text-slate-400">{item.detail}</div>}
                    </div>
                    {chosen && <span aria-hidden="true" className="text-plum-600 dark:text-plum-300">✓</span>}
                  </li>
                );
              })}
            </ul>
            <KeyHints toggle />
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}
