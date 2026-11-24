"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { trapTab } from "@/lib/landing/focus-trap";

/**
 * The window of an Exit popup (docs/product/LANDING_PAGES.md, "Exit popup"). Loaded on demand by ExitPopup.tsx, so the public page
 * carries none of this until a popup can really show.
 *
 * Drawn on `<body>` (a fixed overlay inside the page frame would be held by its `@container`), with the frame's own style classes
 * (`frameClass`: its colours, buttons and fonts) put on the wrapper so the blocks inside look as they do on the page. It is a dialog
 * with a name; the first Tab stop is the close button, Tab stays inside, Escape closes, the page behind does not scroll, and focus
 * goes back to where it was. The fade is `landing-fade-in`, which only runs when the visitor has not asked for less motion.
 */

export type ExitPopupDialogProps = {
  label: string;
  /** The box: width and background (`popupBoxClasses`). */
  boxClass: string;
  /** The page frame's style classes, so the popup is drawn as the page is. */
  frameClass: string;
  closeOnOverlay: boolean;
  onClose: () => void;
  children: ReactNode;
};

export default function ExitPopupDialog({ label, boxClass, frameClass, closeOnOverlay, onClose, children }: ExitPopupDialogProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const pressedOnOverlay = useRef(false);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The page behind stays put while the popup is open, and gets back exactly what it had (an inline style of its own included).
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      }
    };
    // Focus that gets out (a click on the page behind, a script) is brought back in.
    const onFocusIn = (event: FocusEvent) => {
      const box = dialog.current;
      if (box && event.target instanceof Node && !box.contains(event.target)) box.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return createPortal(
    <div
      data-exit-popup
      // Tab stays inside the box (an element-level handler: it acts only while focus is in the popup).
      onKeyDown={(event) => {
        if (dialog.current) trapTab(event, dialog.current);
      }}
      className={`${frameClass} fixed inset-0 z-overlay flex items-center justify-center bg-black/60 p-4`}
      // A click that starts inside the box and ends on the overlay (selecting text) does not close it.
      onMouseDown={(event) => {
        pressedOnOverlay.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (closeOnOverlay && pressedOnOverlay.current && event.target === event.currentTarget) onClose();
        pressedOnOverlay.current = false;
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={label || "Pop-up"}
        tabIndex={-1}
        className={`landing-fade-in @container relative max-h-[90vh] w-full overflow-y-auto rounded-xl p-6 shadow-2xl focus:outline-none ${boxClass}`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full text-2xl leading-none hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plum-600"
        >
          <span aria-hidden="true">×</span>
        </button>
        <div className="flow-root pt-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
