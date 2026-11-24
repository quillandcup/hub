"use client";

import { useSyncExternalStore, type ReactNode } from "react";

/**
 * How an Exit popup shows in the editor's canvas (docs/product/LANDING_PAGES.md, "Exit popup"). A popup is not part of the page's flow,
 * so the canvas draws it as a bar in place (what it is and when it shows) and, while "Edit popup" is on, its box with the blocks in it,
 * where they can be selected, dragged and changed like any other. The switch is a view setting of the editor, not of the page: it is
 * kept here for as long as the editor is open and is never saved, so turning it on changes nothing a visitor sees.
 */

let showing = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function setEditingPopup(on: boolean) {
  showing = on;
  for (const listener of listeners) listener();
}

export const useEditingPopup = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => showing,
    () => false,
  );

/** The "Edit popup" switch in the block's fields. It has no value of its own (nothing is stored). */
export function EditPopupField() {
  const on = useEditingPopup();
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>Show the popup in the page, to edit what is in it</span>
      <input type="checkbox" role="switch" checked={on} onChange={(event) => setEditingPopup(event.target.checked)} className="h-4 w-4" />
    </label>
  );
}

export type ExitPopupEditingProps = {
  enabled: boolean;
  /** What the settings say, in words (`describeExitPopup`). */
  summary: string;
  /** The box's width and background classes (`popupBoxClasses`). */
  boxClass: string;
  /** The popup's blocks: the slot, to drop into. */
  children: ReactNode;
};

export default function ExitPopupEditing({ enabled, summary, boxClass, children }: ExitPopupEditingProps) {
  const on = useEditingPopup();
  return (
    <div data-exit-popup-editor className="border-y border-dashed border-accent bg-tile">
      <p className="px-4 py-2 text-center text-xs text-ink-muted">
        <strong className="font-semibold text-ink">Exit popup: {enabled ? "on" : "off"}.</strong> {summary} Visitors see it over the page.{" "}
        {on ? "Edit it below." : "Turn on Edit popup in the panel to see it and change what is in it."}
      </p>
      {on && (
        <div className="bg-black/10 px-4 py-6">
          <div className={`@container relative mx-auto w-full rounded-xl p-6 shadow-lg ${boxClass}`}>
            <span aria-hidden="true" className="absolute right-3 top-2 text-2xl leading-none opacity-60">
              ×
            </span>
            <div className="flow-root pt-4">{children}</div>
          </div>
        </div>
      )}
    </div>
  );
}
