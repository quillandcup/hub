import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Focus state for a search box with a dropdown. Blurring closes the dropdown only after a short
 * delay, so a click on one of its options (which blurs the input first) still lands.
 *
 * The delay is a timer, and an uncleared one is a bug: it fires after the component has gone away
 * and sets state on it (in tests, after the DOM is torn down, which surfaced as an unhandled
 * `window is not defined` that failed whole CI runs at random). So this clears it on unmount, and
 * focusing again before it fires cancels it.
 */
export function useBlurDelay(delayMs = 200) {
  const [isFocused, setIsFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  const onFocus = useCallback(() => {
    cancel();
    setIsFocused(true);
  }, [cancel]);

  const onBlur = useCallback(() => {
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      setIsFocused(false);
    }, delayMs);
  }, [cancel, delayMs]);

  /** For closing the dropdown right away (after picking an option); drops any pending delayed close. */
  const setFocused = useCallback(
    (focused: boolean) => {
      cancel();
      setIsFocused(focused);
    },
    [cancel]
  );

  return { isFocused, setIsFocused: setFocused, onFocus, onBlur };
}
