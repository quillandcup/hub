"use client";

import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { placeMenu, type MenuPlacement } from "@/lib/menu-placement";

export interface ActionMenuItem {
  key: string;
  label: string;
  /** A link item navigates; otherwise `onSelect` runs. */
  href?: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** Small muted line under the label: why an item is off. */
  hint?: string;
  /** Value for `data-track`. */
  track?: string;
  /** A divider line above this item. */
  separatorBefore?: boolean;
}

const ITEM =
  "block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 focus:bg-slate-50 focus:outline-none dark:hover:bg-slate-800 dark:focus:bg-slate-800 aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

/**
 * A vertical-ellipsis menu of secondary actions. Arrow Up/Down move (wrapping), Home/End jump,
 * Escape closes and puts focus back on the button, Tab or a click outside closes. A disabled item
 * stays in the list (with its `hint`) but cannot be chosen.
 */
export default function ActionMenu({
  label = "More actions",
  items,
  trigger,
  triggerClassName,
  heading,
}: {
  label?: string;
  items: readonly ActionMenuItem[];
  /** What the button shows instead of the three dots (with `triggerClassName` for its look). */
  trigger?: React.ReactNode;
  triggerClassName?: string;
  /** A muted title at the top of the panel ("Jump to..."). */
  heading?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  const menuId = useId();

  const enabledItems = () => Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);

  useEffect(() => {
    if (!open) return;
    enabledItems()[0]?.focus();
    const onPointer = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  // Measure before paint and keep the panel inside the viewport (a trigger near the left edge of a
  // phone would otherwise open it off screen).
  useLayoutEffect(() => {
    if (!open || !button.current || !panel.current) {
      setPlacement(null);
      return;
    }
    const place = () => {
      const t = button.current!.getBoundingClientRect();
      const width = document.documentElement.clientWidth || window.innerWidth;
      setPlacement(placeMenu(t, { width: panel.current!.offsetWidth, height: panel.current!.offsetHeight }, { width, height: window.innerHeight }));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    const list = enabledItems();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(at + 1) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(at - 1 + list.length) % list.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      list[list.length - 1]?.focus();
    }
  };

  if (items.length === 0) return null;
  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={
          triggerClassName ??
          "flex h-10 w-10 items-center justify-center rounded border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        }
      >
        {trigger ?? (
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
            <circle cx="10" cy="4" r="1.6" />
            <circle cx="10" cy="10" r="1.6" />
            <circle cx="10" cy="16" r="1.6" />
          </svg>
        )}
      </button>
      {open && (
        <div
          ref={panel}
          id={menuId}
          role="menu"
          aria-label={label}
          data-placement={placement ? (placement.above ? "above" : "below") : undefined}
          // Fixed, placed from the trigger's viewport position: a row with overflow hidden can't clip it.
          style={{ left: placement?.left ?? 0, top: placement?.top ?? 0, maxWidth: placement?.maxWidth }}
          className="fixed z-50 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {heading && (
            <div aria-hidden="true" className="px-3 pb-1 pt-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
              {heading}
            </div>
          )}
          {items.map((item) => {
            const sep = item.separatorBefore ? <div key={`${item.key}-sep`} role="separator" className="my-1 border-t border-slate-200 dark:border-slate-700" /> : null;
            const body = (
              <>
                <span className="font-medium">{item.label}</span>
                {item.hint && <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400">{item.hint}</span>}
              </>
            );
            if (item.href && !item.disabled) {
              return (
                <Fragment key={item.key}>{sep}<Link href={item.href} role="menuitem" data-track={item.track} onClick={() => setOpen(false)} className={ITEM}>
                  {body}
                </Link></Fragment>
              );
            }
            return (
              <Fragment key={item.key}>
              {sep}
              <button
                type="button"
                role="menuitem"
                aria-disabled={item.disabled || undefined}
                data-track={item.track}
                onClick={() => {
                  if (item.disabled) return;
                  setOpen(false);
                  item.onSelect?.();
                }}
                className={ITEM}
              >
                {body}
              </button>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
