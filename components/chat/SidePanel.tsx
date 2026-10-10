"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const STORAGE_KEY = "chat.sidePanelWidth";
const DEFAULT_WIDTH = 384;
const MIN_WIDTH = 320;
const MAX_WIDTH = 900;
/** The panel never takes more than this share of the space beside the conversation list. */
const MAX_SHARE = 0.6;
const KEY_STEP = 24;
const KEY_STEP_BIG = 96;

/**
 * The right-hand panel beside a conversation, as in Slack: a thread or a profile, opened by a
 * link (?thread= / ?profile=) and closed by the link back to the bare conversation. It scrolls on
 * its own; on narrow screens it covers the conversation instead of squeezing it.
 *
 * On wider screens its left edge is a handle: drag it (or focus it and use the arrow keys, Shift for
 * bigger steps) to make the panel wider for a long thread, double-click or press Enter to put it
 * back. The width is remembered on this device and shared by threads and profiles.
 */
export default function SidePanel({
  title,
  closeHref,
  children,
}: {
  title: string;
  closeHref: string;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  // The most the panel may take: its cap, and a share of the row it sits in so the messages keep room.
  const limit = () => {
    const row = panel.current?.parentElement?.clientWidth ?? 0;
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, row ? row * MAX_SHARE : MAX_WIDTH));
  };
  const clamp = (w: number) => Math.round(Math.min(limit(), Math.max(MIN_WIDTH, w)));
  const remember = (w: number) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(w));
    } catch {
      // Private mode or storage off: the width just isn't remembered.
    }
  };

  // Restore the saved width before the first paint (not during render, which would not match the server's).
  useLayoutEffect(() => {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a client-only saved value, applied after hydration
      if (Number.isFinite(saved) && saved > 0) setWidth(clamp(saved));
    } catch {
      // Storage unavailable: keep the default.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  // While dragging, the pointer must not select text in the messages it passes over.
  useEffect(() => {
    if (!dragging) return;
    const before = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = before;
    };
  }, [dragging]);

  const resizeTo = (w: number) => {
    const next = clamp(w);
    setWidth(next);
    remember(next);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    if (e.key === "ArrowLeft") resizeTo(width + step);
    else if (e.key === "ArrowRight") resizeTo(width - step);
    else if (e.key === "Enter") resizeTo(DEFAULT_WIDTH);
    else if (e.key === "Home") resizeTo(MIN_WIDTH);
    else if (e.key === "End") resizeTo(MAX_WIDTH);
    else return;
    e.preventDefault();
  };

  return (
    <aside
      ref={panel}
      aria-label={title}
      style={{ "--chat-panel-width": `${width}px` } as React.CSSProperties}
      className="relative flex h-full min-h-0 shrink-0 flex-col border-l border-slate-200 bg-canvas dark:border-slate-800 dark:bg-slate-950 max-md:absolute max-md:inset-0 max-md:z-20 md:w-[var(--chat-panel-width)] md:min-w-[20rem] md:max-w-[60%]"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${title.toLowerCase()}`}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onDoubleClick={() => resizeTo(DEFAULT_WIDTH)}
        onPointerDown={(e) => {
          drag.current = { startX: e.clientX, startWidth: width };
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setDragging(true);
        }}
        onPointerMove={(e) => {
          // The panel is on the right, so dragging left makes it wider.
          if (drag.current) setWidth(clamp(drag.current.startWidth + (drag.current.startX - e.clientX)));
        }}
        onPointerUp={(e) => {
          if (!drag.current) return;
          const next = clamp(drag.current.startWidth + (drag.current.startX - e.clientX));
          drag.current = null;
          setDragging(false);
          setWidth(next);
          remember(next);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
        className={`absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none transition-colors hover:bg-plum-300/60 focus-visible:bg-plum-400/70 focus-visible:outline-none max-md:hidden ${
          dragging ? "bg-plum-400/70" : ""
        }`}
      />
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h2 className="font-semibold">{title}</h2>
        <Link
          href={closeHref}
          scroll={false}
          aria-label={`Close ${title.toLowerCase()}`}
          className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          ✕
        </Link>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4">{children}</div>
    </aside>
  );
}
