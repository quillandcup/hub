"use client";

import type { HTMLAttributes, ReactNode } from "react";
import Icon from "@/components/Icon";
import Tooltip from "@/components/Tooltip";

interface PillProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  children: ReactNode;
  onRemove: () => void;
  /** The remove button's accessible name ("Remove logo", "Remove Year placeholder"). */
  removeLabel: string;
  /**
   * Where the remove control sits. `inline`: a × after the text that is always there (a tag box). `corner`: a small × on the
   * upper-right corner that shows when the pill is hovered, focused or selected (a pill inside text, where a permanent × would
   * crowd the line).
   */
  removeStyle?: "inline" | "corner";
  /** Marks the pill as the selected one in an editor (a node selection), which shows its × as well. */
  selected?: boolean;
  /** `data-track` for the remove button, where the click is worth recording. */
  removeTrack?: string;
}

/**
 * THE plum pill: a tag in a tag box (`TagInput`) and a placeholder inside a line of text (`PlaceholderTextField`). One look, one
 * remove control with its own name. Taking a pill away by keyboard is the host's: Backspace in the empty tag box, Backspace or
 * Delete beside a placeholder.
 */
export default function Pill({ children, onRemove, removeLabel, removeStyle = "inline", selected = false, removeTrack, className = "", ...rest }: PillProps) {
  const corner = removeStyle === "corner";
  const button = (
    <button
      type="button"
      data-track={removeTrack}
      tabIndex={corner ? -1 : undefined}
      aria-label={removeLabel}
      // Press, not click, so an editor around the pill keeps its selection.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRemove}
      className={
        corner
          ? `absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-plum-600 text-white opacity-0 shadow-sm transition-opacity hover:bg-plum-700 focus-visible:opacity-100 group-hover:opacity-100 ${selected ? "opacity-100" : ""}`
          : "rounded-full w-4 h-4 leading-none text-xs hover:bg-plum-100 dark:hover:bg-plum-800"
      }
    >
      {corner ? <Icon name="close" className="h-3 w-3" /> : "×"}
    </button>
  );
  return (
    <span
      {...rest}
      className={`group relative inline-flex items-center gap-1 rounded-full bg-plum-50 py-0.5 text-sm text-plum-700 dark:bg-plum-900/30 dark:text-plum-300 ${corner ? "px-2.5" : "pl-2.5 pr-1"} ${selected ? "ring-2 ring-plum-500" : ""} ${className}`}
    >
      {children}
      {corner ? <Tooltip content={removeLabel}>{button}</Tooltip> : button}
    </span>
  );
}
