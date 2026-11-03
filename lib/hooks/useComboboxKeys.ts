import { useId, useState, type KeyboardEvent, type MouseEvent } from "react";

/** What the list needs of a key press: React's keyboard event satisfies it, and so does a wrapped native one (an editor's). */
export type ComboboxKeyEvent = Pick<KeyboardEvent, "key" | "preventDefault" | "stopPropagation"> & { nativeEvent: { isComposing: boolean } };

/**
 * Keyboard and ARIA wiring for any list that pops up under a text box (the WAI-ARIA combobox pattern), so every
 * one of them behaves the same: ArrowDown/ArrowUp move through the options (wrapping), Enter picks the
 * highlighted one (or the only one), Escape closes, and none of it fires while an input method is composing.
 * Focus stays in the box; the highlighted option is announced through aria-activedescendant.
 *
 * Use it for every dropdown or suggestion list (`EntitySearch`, the message box's `@`, `#` and `:` choices) and
 * don't write arrow-key handling by hand. Options: `preselect` highlights the first one at once (Slack's
 * suggestions, where Enter takes it) instead of waiting for an arrow key; `pickOnTab` makes Tab pick too.
 */
export function useComboboxKeys({
  count,
  options,
  onPick,
  onEscape,
  preselect = false,
  pickOnTab = false,
}: {
  /** How many options are showing; 0 leaves every key but Escape to the box. */
  count: number;
  /** The options showing; a different set (a new search) resets the highlight. */
  options: unknown;
  onPick: (index: number) => void;
  /** Return true if Escape did something, so it doesn't also bubble (e.g. closing a modal). */
  onEscape: () => boolean;
  preselect?: boolean;
  pickOnTab?: boolean;
}) {
  const first = preselect ? 0 : -1;
  // The highlight remembers which option set it belongs to, so new results start at `first`.
  const [highlight, setHighlight] = useState<{ index: number; options: unknown }>({ index: first, options });
  const listboxId = useId();
  const optionId = (i: number) => `${listboxId}-${i}`;
  const activeIndex = highlight.options === options ? highlight.index : first;
  // A stale index (the options shrank) counts as nothing highlighted.
  const active = activeIndex < count ? activeIndex : -1;
  const setActiveIndex = (next: number | ((i: number) => number)) =>
    setHighlight({ index: typeof next === "function" ? next(activeIndex) : next, options });

  /** Handles the key if it is the list's; returns whether it did, so the box's owner can have the rest. */
  const handleKey = (e: ComboboxKeyEvent): boolean => {
    if (e.nativeEvent.isComposing) return false;
    // Escape is the owner's to act on even with nothing listed (clearing the search); the other keys need options.
    if (e.key === "Escape") {
      if (!onEscape()) return false;
      e.preventDefault();
      e.stopPropagation();
      setActiveIndex(first);
      return true;
    }
    if (count === 0) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1 >= count ? 0 : i + 1));
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 || i >= count ? count - 1 : i - 1));
      return true;
    }
    if (e.key === "Enter" || (pickOnTab && e.key === "Tab")) {
      const index = active >= 0 ? active : count === 1 ? 0 : -1;
      if (index < 0) return false;
      e.preventDefault();
      onPick(index);
      setActiveIndex(first);
      return true;
    }
    return false;
  };

  return {
    activeIndex: active,
    reset: () => setActiveIndex(first),
    handleKey,
    inputProps: (expanded: boolean) => ({
      role: "combobox" as const,
      "aria-expanded": expanded,
      "aria-controls": listboxId,
      "aria-autocomplete": "list" as const,
      "aria-activedescendant": expanded && active >= 0 ? optionId(active) : undefined,
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => void handleKey(e),
    }),
    listboxProps: { id: listboxId, role: "listbox" as const },
    optionProps: (i: number) => ({
      id: optionId(i),
      role: "option" as const,
      "aria-selected": i === active,
      // Keep focus in the box so the list doesn't close before the click lands.
      onMouseDown: (e: MouseEvent) => e.preventDefault(),
      onMouseEnter: () => setActiveIndex(i),
    }),
  };
}
