"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import Modal from "@/components/Modal";
import { fitView, zoomAt, type PanZoomView } from "@/lib/pan-zoom";

const DRAG_THRESHOLD = 4;
const BUTTON_ZOOM = 1.25;

/**
 * A fixed-size diagram you can pan and zoom, like the workflow graph on GitHub Actions: drag to pan,
 * pinch or Ctrl/Cmd-scroll to zoom, +/−/fit buttons for the same without a mouse. It opens fitted to
 * the container. A press that doesn't move still clicks the links inside; a drag doesn't.
 */
export default function PanZoomCanvas({
  width,
  height,
  className = "h-[28rem]",
  expandTitle,
  children,
}: {
  width: number;
  height: number;
  className?: string;
  /** Adds an expand button that opens the same canvas in a near-full-screen overlay with this title. */
  expandTitle?: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<PanZoomView>({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ moved: boolean; pinch: number | null; origin: { x: number; y: number } }>({ moved: false, pinch: null, origin: { x: 0, y: 0 } });

  const size = () => {
    const r = container.current?.getBoundingClientRect();
    return { width: r?.width || width, height: r?.height || height };
  };
  const fit = useCallback(() => setView(fitView(size(), { width, height })), [width, height]);

  useEffect(() => {
    fit();
  }, [fit]);

  const zoomBy = (factor: number, cx?: number, cy?: number) => {
    const s = size();
    setView((v) => zoomAt(v, factor, cx ?? s.width / 2, cy ?? s.height / 2));
  };

  // A wheel listener has to be non-passive to stop the page from zooming with the diagram.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // plain scrolling still scrolls the page
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView((v) => zoomAt(v, Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag.current = { moved: false, pinch: pointers.current.size === 2 ? distance() : null, origin: { x: e.clientX, y: e.clientY } };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, next);

    if (pointers.current.size === 2 && drag.current.pinch) {
      const d = distance();
      const [a, b] = [...pointers.current.values()];
      const r = container.current!.getBoundingClientRect();
      zoomBy(d / drag.current.pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      drag.current = { ...drag.current, moved: true, pinch: d };
      return;
    }
    if (pointers.current.size !== 1) return;

    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    if (!drag.current.moved) {
      const o = drag.current.origin;
      if (Math.hypot(next.x - o.x, next.y - o.y) < DRAG_THRESHOLD) return;
      drag.current.moved = true;
      container.current?.setPointerCapture(e.pointerId);
    }
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };

  const onPointerEnd = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    drag.current.pinch = null;
  };

  // The click after a drag would open whichever link the pointer ended on.
  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      drag.current.moved = false;
    }
  };

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-amber-50/60 dark:bg-slate-900/60 ${className}`}>
      <div
        ref={container}
        className="absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
        data-testid="pan-zoom-surface"
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ width, height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          data-testid="pan-zoom-content"
        >
          {children}
        </div>
      </div>
      <div className="absolute bottom-3 right-3 flex gap-2">
        {expandTitle && (
          <button type="button" onClick={() => setExpanded(true)} aria-label="Open larger" className="h-9 w-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-lg leading-none">
            ⤢
          </button>
        )}
        <button type="button" onClick={fit} aria-label="Fit to screen" className="h-9 w-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-lg leading-none">
          ⛶
        </button>
        <div className="flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800">
          <button type="button" onClick={() => zoomBy(1 / BUTTON_ZOOM)} aria-label="Zoom out" className="h-9 w-9 text-lg leading-none">
            −
          </button>
          <button type="button" onClick={() => zoomBy(BUTTON_ZOOM)} aria-label="Zoom in" className="h-9 w-9 border-l border-slate-300 dark:border-slate-700 text-lg leading-none">
            +
          </button>
        </div>
      </div>
      {expandTitle && (
        <Modal isOpen={expanded} onClose={() => setExpanded(false)} title={expandTitle} fill>
          <PanZoomCanvas width={width} height={height} className="h-full">
            {children}
          </PanZoomCanvas>
        </Modal>
      )}
    </div>
  );
}
