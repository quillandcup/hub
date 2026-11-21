"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createUsePuck } from "@puckeditor/core";

const usePuck = createUsePuck();

/** Whether the fold line is shown; the header's toggle sets it and the canvas reads it (the canvas is a portal in the same React tree). */
export const FoldContext = createContext<{ visible: boolean; setVisible: (visible: boolean) => void }>({ visible: true, setVisible: () => {} });

/**
 * A dashed line across the canvas at the device's viewport height, measured from the top of the page: where the first
 * screen ends when the page is scrolled to the top. It is drawn inside Puck's canvas iframe (Puck's `iframe` override),
 * so it scrolls with the page as the fold does, and the canvas frame, which is exactly one screen tall for a device,
 * scrolls the page beneath it like a real screen. Nothing shows at desktop, where the height is "auto".
 */
export function FoldMarker({ height, visible }: { height: number | "auto"; visible: boolean }) {
  if (!visible || typeof height !== "number") return null;
  return (
    <div
      data-fold-marker
      aria-hidden="true"
      style={{ position: "absolute", top: height, left: 0, right: 0, pointerEvents: "none", zIndex: 50 }}
      className="border-t-2 border-dashed border-plum-600"
    >
      <span className="absolute right-2 top-0 rounded-b bg-plum-600 px-1.5 py-0.5 text-[11px] font-medium leading-none text-white">Fold: {height}px</span>
    </div>
  );
}

/** Puck's `iframe` override: the page as before, plus the fold line. */
export function FoldFrame({ children }: { children: ReactNode }) {
  const height = usePuck((s) => s.appState.ui.viewports.current.height);
  const { visible } = useContext(FoldContext);
  return (
    <>
      {children}
      <FoldMarker height={height} visible={visible} />
    </>
  );
}
