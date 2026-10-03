"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { OnboardingStepView } from "@/lib/onboarding";

/** Space around the highlighted element, and between it and the callout. */
const PADDING = 6;
const GAP = 12;
const EDGE = 16;
/** Kept clear at the bottom for the folded Getting started bar and the feedback button under it. */
const BOTTOM_RESERVED = 140;
/** Room above the target for the highlight's padding and a little air (<main> scrolls below the header). */
const SCROLL_MARGIN_TOP = 24;
const RESCROLL_AFTER_MS = 500;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Props {
  step: OnboardingStepView;
  stepNumber: number;
  totalSteps: number;
  pending: boolean;
  /** Present for steps the member confirms by hand (step.confirmLabel). */
  onConfirm?: () => void;
  onSkip: () => void;
  onHide: () => void;
}

/**
 * Where the callout goes for a target at `rect`: beside a narrow target (so it doesn't cover the
 * fields under it), else below, else above. `needsRoomAbove` when none of those fit on screen.
 */
function placeCallout(rect: Rect, calloutHeight: number) {
  const viewportW = window.innerWidth;
  const bottomLimit = window.innerHeight - BOTTOM_RESERVED;
  const width = Math.min(352, viewportW - EDGE * 2);
  const beside = rect.left + rect.width + PADDING + GAP;
  const fitsBeside = beside + width <= viewportW - EDGE;
  const below = rect.top + rect.height + PADDING + GAP;
  const fitsBelow = below + calloutHeight <= bottomLimit;
  const above = rect.top - PADDING - GAP - calloutHeight;
  const fitsAbove = above >= EDGE;
  const clampTop = (t: number) => Math.min(Math.max(EDGE, t), bottomLimit - calloutHeight);

  const top = fitsBeside ? clampTop(rect.top - PADDING) : fitsBelow ? below : Math.max(EDGE, above);
  const left = fitsBeside ? beside : Math.min(Math.max(EDGE, rect.left), viewportW - width - EDGE);
  return { top, left, width, needsRoomAbove: !fitsBeside && !fitsBelow && !fitsAbove };
}

/** The nearest ancestor that scrolls: the member layout's <main>, not a page's own inner <main>. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/**
 * Scrolls so `el` sits `margin` px below the top of its scroll container (as far as the page
 * allows). Instant, not smooth: a smooth scroll can stall (seen in a background window) and leave
 * the target off screen, and the spotlight appearing is transition enough.
 */
function scrollTargetTo(el: HTMLElement, margin: number) {
  const scroller = scrollParent(el);
  if (!scroller) {
    el.scrollIntoView({ block: "start" });
    return;
  }
  scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - margin;
}

/** Waits for `[data-tour=<target>]` to render (settings panels load their data after mount). */
function useTarget(target: string): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const find = () => document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
    const frame = requestAnimationFrame(() => setEl(find()));
    // Keep watching: the element can also be replaced or removed (a tab switch, a re-render).
    const observer = new MutationObserver(() => setEl(find()));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [target]);
  return el;
}

/**
 * Dims the page around the current step's control and points at it with a callout. The dimming
 * doesn't catch clicks, so the page stays usable; Escape, "Hide" or using the control closes it
 * for this page.
 */
export default function OnboardingSpotlight({
  step,
  stepNumber,
  totalSteps,
  pending,
  onConfirm,
  onSkip,
  onHide,
}: Props) {
  const el = useTarget(step.target);
  const [rect, setRect] = useState<Rect | null>(null);
  const calloutRef = useRef<HTMLDivElement>(null);
  const [calloutHeight, setCalloutHeight] = useState(0);
  // Space to leave above the target when scrolling to it; grows when the callout has to sit there.
  const scrollMarginRef = useRef(SCROLL_MARGIN_TOP);

  useEffect(() => {
    if (!el) return;
    scrollMarginRef.current = SCROLL_MARGIN_TOP;
    // Just under the page header, leaving room for the callout below it (on a phone there's no
    // room beside). Again shortly after, in case content loading above pushed it back down.
    const scrollToTarget = () => scrollTargetTo(el, scrollMarginRef.current);
    scrollToTarget();
    const rescroll = window.setTimeout(scrollToTarget, RESCROLL_AFTER_MS);
    // Re-measure every frame rather than on scroll/resize events: content loading above the
    // target (a panel fetching its data, an image) moves it without firing either. One
    // getBoundingClientRect a frame, and a re-render only when it actually moved.
    let frame = 0;
    let last: Rect | null = null;
    const tick = () => {
      const r = el.getBoundingClientRect();
      if (!last || r.top !== last.top || r.left !== last.left || r.width !== last.width || r.height !== last.height) {
        last = { top: r.top, left: r.left, width: r.width, height: r.height };
        setRect(last);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      window.clearTimeout(rescroll);
      cancelAnimationFrame(frame);
    };
  }, [el]);

  useLayoutEffect(() => {
    if (calloutRef.current) setCalloutHeight(calloutRef.current.offsetHeight);
  }, [rect, step.id]);

  // A target taller than the screen (the prickle wizard on a phone) leaves no room beside, below
  // or above it, so the callout would cover its top. Scroll it down once to make room above.
  const needsRoomAbove = !!rect && calloutHeight > 0 && placeCallout(rect, calloutHeight).needsRoomAbove;
  useEffect(() => {
    if (!el || !needsRoomAbove) return;
    const scrollerTop = scrollParent(el)?.getBoundingClientRect().top ?? 0;
    const wanted = EDGE + calloutHeight + GAP + PADDING - scrollerTop;
    if (wanted <= scrollMarginRef.current) return;
    scrollMarginRef.current = wanted;
    scrollTargetTo(el, wanted);
  }, [el, needsRoomAbove, calloutHeight]);

  // Using the control (opening the goal form, typing a bio) means they've found it: step aside so
  // the callout doesn't cover what opens. The guide keeps checking, and ticks the step off once saved.
  // Not for a step finished from the callout itself ("My names look right"): it has to stay up.
  const hidesOnUse = !step.confirmLabel;
  useEffect(() => {
    if (!el || !hidesOnUse) return;
    el.addEventListener("click", onHide);
    return () => el.removeEventListener("click", onHide);
  }, [el, onHide, hidesOnUse]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onHide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onHide]);

  if (!el || !rect) return null;

  const { top, left, width: calloutW } = placeCallout(rect, calloutHeight);

  return (
    <>
      <div
        data-testid="onboarding-highlight"
        aria-hidden="true"
        className="fixed z-40 pointer-events-none rounded-lg ring-2 ring-plum-400"
        style={{
          top: rect.top - PADDING,
          left: rect.left - PADDING,
          width: rect.width + PADDING * 2,
          height: rect.height + PADDING * 2,
          boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.45)",
        }}
      />
      <div
        ref={calloutRef}
        role="dialog"
        aria-label={step.title}
        // Above the mobile menu button (fixed, z-50), which would otherwise poke through it.
        className="fixed z-[55] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-4"
        style={{ top, left, width: calloutW }}
      >
        <p className="text-xs font-medium text-plum-600 dark:text-plum-400">
          Step {stepNumber} of {totalSteps}
        </p>
        <h2 className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">{step.title}</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{step.hint}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {onConfirm && step.confirmLabel && (
            <button
              type="button"
              disabled={pending}
              onClick={onConfirm}
              className="px-3 py-1.5 bg-plum-600 hover:bg-plum-700 disabled:opacity-60 text-white rounded-md text-sm font-medium"
            >
              {step.confirmLabel}
            </button>
          )}
          {!onConfirm && (
            <button
              type="button"
              disabled={pending}
              onClick={onSkip}
              className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:underline disabled:opacity-60"
            >
              Skip this step
            </button>
          )}
          <button
            type="button"
            onClick={onHide}
            className="ml-auto px-3 py-1.5 text-sm text-slate-500 dark:text-slate-400 hover:underline"
          >
            Hide
          </button>
        </div>
      </div>
    </>
  );
}
