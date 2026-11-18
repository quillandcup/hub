"use client";

import { cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * THE tooltip for a control: a short hint on an icon button, a toggle, a link. Wrap the one control:
 *
 *   <Tooltip content="Pin to my dashboard"><button aria-label="Pin to my dashboard">...</button></Tooltip>
 *
 * Rules it keeps (`.claude/rules/tooltips.md`):
 * - Never the only place essential information lives: the control keeps its own name (`aria-label` or visible text);
 *   the tip is a description, linked to the control with `aria-describedby` while it is shown.
 * - Shows on hover only where there is a hover (`(hover: hover)`, checked when the pointer arrives) and never for a
 *   touch pointer, so a tap never leaves one stuck; shows on keyboard focus (`:focus-visible`), not on a tap or click.
 * - A short delay before it shows on hover, so moving across a list doesn't flash one per row.
 * - Escape hides it; it stays up while the pointer is over the tip itself (WCAG 1.4.13).
 * - Drawn on `<body>` (fixed, placed from the control's rectangle, kept inside the window, flipped above when there is
 *   no room below), so a scrolling card or a modal's `overflow-hidden` can't clip it. Layer: `z-overlay-top`.
 * - Adds no wrapper element: it hands its handlers to the child, so the layout around the control is unchanged.
 *
 * The child is one element that takes `onPointerEnter`, `onPointerLeave`, `onFocus`, `onBlur` and `aria-describedby`
 * (any DOM element does; a component must pass them on). For a definition that needs rich text or a link, use `InfoTip`.
 */

const SHOW_DELAY_MS = 400;
const HIDE_DELAY_MS = 120;
const GAP = 6;
const EDGE = 8;

type Rect = { left: number; right: number; top: number; bottom: number };

/** Where the tip goes, in the window's coordinates: centred under the control, kept inside the window, above it when there is no room below. */
export function placeTip(anchor: Rect, tip: { width: number; height: number }, viewport: { width: number; height: number }) {
  const centred = (anchor.left + anchor.right) / 2 - tip.width / 2;
  const left = Math.max(EDGE, Math.min(centred, viewport.width - tip.width - EDGE));
  const below = anchor.bottom + GAP;
  const fitsBelow = below + tip.height + EDGE <= viewport.height;
  const above = anchor.top - GAP - tip.height;
  const top = fitsBelow || above < EDGE ? below : above;
  return { left, top };
}

/** Hover is for devices that have it; checked at the moment the pointer arrives (no render-time branch, no hydration mismatch). */
function canHover(): boolean {
  return typeof window.matchMedia !== "function" || window.matchMedia("(hover: hover)").matches;
}

/** True for keyboard-style focus. A click or tap focuses a button too, but `:focus-visible` doesn't match then. */
function focusIsVisible(target: Element): boolean {
  try {
    return target.matches(":focus-visible");
  } catch {
    return true; // an engine without :focus-visible: show, the safe side for keyboard users
  }
}

type Handlers = {
  "aria-describedby"?: string;
  onPointerEnter?: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (e: PointerEvent<HTMLElement>) => void;
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
};

export default function Tooltip({ content, children, delayMs = SHOW_DELAY_MS }: { content: ReactNode; children: ReactElement<Handlers>; delayMs?: number }) {
  const tipId = useId();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // A change of mind that takes effect after a delay (show after the hover pause, hide after the grace period). Held as
  // state so that a newer one replaces the older: the effect's cleanup is what cancels the pending timer.
  const [pending, setPending] = useState<{ show: boolean; ms: number } | null>(null);

  useEffect(() => {
    if (!pending) return;
    const id = setTimeout(() => {
      setOpen(pending.show);
      setPending(null);
    }, pending.ms);
    return () => clearTimeout(id);
  }, [pending]);

  const showAfter = useCallback((ms: number) => {
    if (ms <= 0) {
      setPending(null);
      setOpen(true);
    } else setPending({ show: true, ms });
  }, []);
  const hideAfter = useCallback((ms: number) => {
    if (ms <= 0) {
      setPending(null);
      setOpen(false);
    } else setPending({ show: false, ms });
  }, []);
  const clear = useCallback(() => setPending(null), []);
  const dismiss = useCallback(() => hideAfter(0), [hideAfter]);

  if (content === null || content === undefined || content === false || content === "") return children;

  const own = children.props;
  const describedBy = [own["aria-describedby"], open ? tipId : null].filter(Boolean).join(" ") || undefined;

  return (
    <>
      {cloneElement(children, {
        "aria-describedby": describedBy,
        onPointerEnter: (e) => {
          own.onPointerEnter?.(e);
          if (e.pointerType === "touch" || !canHover()) return;
          setAnchor(e.currentTarget);
          showAfter(delayMs);
        },
        onPointerLeave: (e) => {
          own.onPointerLeave?.(e);
          hideAfter(HIDE_DELAY_MS);
        },
        onPointerDown: (e) => {
          own.onPointerDown?.(e);
          // A press is not a hover: a click on the control, or a tap, dismisses it.
          hideAfter(0);
        },
        onFocus: (e) => {
          own.onFocus?.(e);
          if (!focusIsVisible(e.currentTarget)) return;
          setAnchor(e.currentTarget);
          showAfter(0);
        },
        onBlur: (e) => {
          own.onBlur?.(e);
          hideAfter(0);
        },
      })}
      {open && anchor && (
        <Bubble id={tipId} anchor={anchor} onEnter={clear} onLeave={() => hideAfter(HIDE_DELAY_MS)} onDismiss={dismiss}>
          {content}
        </Bubble>
      )}
    </>
  );
}

/** The box itself, drawn on `<body>`. It exists only while shown, so its position starts empty each time. */
function Bubble({ id, anchor, onEnter, onLeave, onDismiss, children }: { id: string; anchor: HTMLElement; onEnter: () => void; onLeave: () => void; onDismiss: () => void; children: ReactNode }) {
  const tipRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Placement: from the control's rectangle, again on scroll and resize while it is shown. A control that is gone or
  // hidden (a hover toolbar that closed) has no rectangle: the tip goes with it.
  useLayoutEffect(() => {
    const place = (follow: boolean) => {
      const tip = tipRef.current?.getBoundingClientRect();
      if (!tip) return;
      const rect = anchor.getBoundingClientRect();
      if (follow && (!anchor.isConnected || (rect.width === 0 && rect.height === 0))) {
        onDismiss();
        return;
      }
      setPos(placeTip(rect, tip, { width: document.documentElement.clientWidth, height: window.innerHeight }));
    };
    place(false);
    const follow = () => place(true);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [anchor, children, onDismiss]);

  // Escape dismisses it without moving the pointer or focus (WCAG 1.4.13).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return createPortal(
    <span
      id={id}
      ref={tipRef}
      role="tooltip"
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
      className="fixed z-overlay-top block w-max max-w-[min(20rem,calc(100vw-1rem))] rounded-md bg-slate-900 px-2 py-1.5 text-left text-xs font-normal normal-case leading-snug tracking-normal text-white shadow-lg dark:bg-slate-700"
    >
      {children}
    </span>,
    document.body,
  );
}
