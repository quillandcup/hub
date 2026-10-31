"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * A one-shot delayed callback that is safe to start from an event handler: starting it again
 * replaces the pending one (one timer, never two), and a pending one is cleared on unmount, so it
 * can't fire into a torn-down component ("window is not defined" in tests, a state update on an
 * unmounted component in the browser). Use it for "show Copied for 2 s" style resets.
 */
export function useTimeout(): (callback: () => void, delayMs: number) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return useCallback((callback, delayMs) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      callback();
    }, delayMs);
  }, []);
}
