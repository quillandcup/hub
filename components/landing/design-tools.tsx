"use client";

import { useSyncExternalStore } from "react";

/**
 * The editor's design tools (docs/LANDING_PAGES.md, "Settings"): guides (an outline around every block) and a 12-column grid over
 * the canvas. They are for the person editing and never reach a visitor: the overlay is drawn only in the editor's canvas, and the
 * choice is kept per browser (local storage), not on the page. One store, so the Settings panel (in the editor's shell) and the
 * overlay (inside the canvas's frame) agree without the page's data knowing about it.
 */

export type DesignTools = { guides: boolean; grid: boolean };
const KEY = "landing-design-tools";
const OFF: DesignTools = { guides: false, grid: false };

const listeners = new Set<() => void>();
let current: DesignTools = OFF;
let loaded = false;

function load(): DesignTools {
  if (!loaded && typeof window !== "undefined") {
    loaded = true;
    try {
      const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<DesignTools> | null;
      current = { guides: stored?.guides === true, grid: stored?.grid === true };
    } catch {
      current = OFF;
    }
  }
  return current;
}

export function setDesignTools(patch: Partial<DesignTools>) {
  current = { ...load(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // A browser that won't store it still shows the tools for this visit.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useDesignTools(): DesignTools {
  return useSyncExternalStore(subscribe, load, () => OFF);
}

/** Drawn inside the canvas's frame (which is `position: relative` here): the grid over it, and the guides as one rule for everything in it. */
export function DesignToolsOverlay() {
  const { guides, grid } = useDesignTools();
  return (
    <>
      {guides && <style>{"[data-lp-frame] * { outline: 1px dashed rgb(var(--lp-accent) / 0.45); outline-offset: -1px; }"}</style>}
      {grid && (
        <div aria-hidden="true" data-lp-grid className="pointer-events-none absolute inset-0 mx-auto grid max-w-5xl grid-cols-12 gap-4 px-4">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className="bg-accent/10" />
          ))}
        </div>
      )}
    </>
  );
}
