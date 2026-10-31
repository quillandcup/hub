// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useTimeout } from "@/components/useTimeout";

describe("useTimeout", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("runs the callback once after the delay", () => {
    const { result } = renderHook(() => useTimeout());
    const callback = vi.fn();

    result.current(callback, 500);
    expect(vi.getTimerCount()).toBe(1);
    act(() => void vi.advanceTimersByTime(499));
    expect(callback).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(callback).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("replaces a pending timer when started again: one timer, and only the last callback runs", () => {
    const { result } = renderHook(() => useTimeout());
    const first = vi.fn();
    const second = vi.fn();

    result.current(first, 500);
    result.current(second, 500);
    expect(vi.getTimerCount()).toBe(1);
    act(() => void vi.advanceTimersByTime(500));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("clears a pending timer on unmount", () => {
    const { result, unmount } = renderHook(() => useTimeout());
    const callback = vi.fn();

    result.current(callback, 500);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(callback).not.toHaveBeenCalled();
  });

  it("unmounts cleanly with nothing pending", () => {
    const { unmount } = renderHook(() => useTimeout());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns the same function on every render", () => {
    const { result, rerender } = renderHook(() => useTimeout());
    const start = result.current;
    rerender();
    expect(result.current).toBe(start);
  });
});
