// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useBlurDelay } from "@/lib/hooks/useBlurDelay";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useBlurDelay", () => {
  it("is focused on focus, and closes only after the delay once blurred", () => {
    const { result } = renderHook(() => useBlurDelay(200));
    expect(result.current.isFocused).toBe(false);

    act(() => result.current.onFocus());
    expect(result.current.isFocused).toBe(true);

    act(() => result.current.onBlur());
    // Still open, so a click on a dropdown option can land.
    expect(result.current.isFocused).toBe(true);
    act(() => void vi.advanceTimersByTime(199));
    expect(result.current.isFocused).toBe(true);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.isFocused).toBe(false);
  });

  it("stays open when focus comes back before the delay is up", () => {
    const { result } = renderHook(() => useBlurDelay(200));
    act(() => result.current.onFocus());
    act(() => result.current.onBlur());
    act(() => void vi.advanceTimersByTime(100));
    act(() => result.current.onFocus());
    act(() => void vi.advanceTimersByTime(500));

    expect(result.current.isFocused).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restarts the delay on a second blur rather than stacking timers", () => {
    const { result } = renderHook(() => useBlurDelay(200));
    act(() => result.current.onFocus());
    act(() => result.current.onBlur());
    act(() => void vi.advanceTimersByTime(150));
    act(() => result.current.onBlur());

    expect(vi.getTimerCount()).toBe(1);
    act(() => void vi.advanceTimersByTime(199));
    expect(result.current.isFocused).toBe(true);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.isFocused).toBe(false);
  });

  it("clears a pending close when the component unmounts, so nothing fires afterwards", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useBlurDelay(200));
    act(() => result.current.onFocus());
    act(() => result.current.onBlur());
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("closes right away on setIsFocused(false), and drops the delayed close that was pending", () => {
    const { result } = renderHook(() => useBlurDelay(200));
    act(() => result.current.onFocus());
    act(() => result.current.onBlur());
    act(() => result.current.setIsFocused(false));

    expect(result.current.isFocused).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the given delay", () => {
    const { result } = renderHook(() => useBlurDelay(50));
    act(() => result.current.onFocus());
    act(() => result.current.onBlur());
    act(() => void vi.advanceTimersByTime(50));

    expect(result.current.isFocused).toBe(false);
  });
});
