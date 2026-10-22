// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFileDrop } from "@/components/chat/useFileDrop";

function dragEvent(type: string, opts: { files?: File[]; types?: string[]; noTransfer?: boolean } = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer?: unknown };
  if (!opts.noTransfer) e.dataTransfer = { types: opts.types ?? ["Files"], files: opts.files ?? [] };
  return e;
}
const fire = (el: EventTarget, e: Event) => act(() => void el.dispatchEvent(e));

describe("useFileDrop", () => {
  it("shows the drop state while files are over the element and hands over the dropped files", () => {
    const el = document.createElement("div");
    const onFiles = vi.fn();
    const { result } = renderHook(() => useFileDrop(() => el, onFiles));
    expect(result.current).toEqual({ dragging: false, rect: null });

    const entered = dragEvent("dragenter");
    fire(el, entered);
    expect(entered.defaultPrevented).toBe(true);
    expect(result.current.dragging).toBe(true);
    expect(result.current.rect).not.toBeNull();

    const over = dragEvent("dragover");
    fire(el, over);
    expect(over.defaultPrevented).toBe(true);

    const file = new File(["x"], "a.png", { type: "image/png" });
    fire(el, dragEvent("drop", { files: [file] }));
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(result.current.dragging).toBe(false);
  });

  it("stays on until the last nested dragleave, and ends on dragend", () => {
    const el = document.createElement("div");
    const stable = vi.fn();
    const { result } = renderHook(() => useFileDrop(() => el, stable));
    fire(el, dragEvent("dragenter"));
    fire(el, dragEvent("dragenter"));
    fire(el, dragEvent("dragleave"));
    expect(result.current.dragging).toBe(true);
    fire(el, dragEvent("dragleave"));
    expect(result.current.dragging).toBe(false);
    fire(el, dragEvent("dragleave"));
    fire(el, dragEvent("dragenter"));
    fire(window, new Event("dragend"));
    expect(result.current.dragging).toBe(false);
  });

  it("ignores drags that carry no files, and a drop with no files or no data", () => {
    const el = document.createElement("div");
    const onFiles = vi.fn();
    const { result } = renderHook(() => useFileDrop(() => el, onFiles));
    for (const type of ["dragenter", "dragleave", "drop"]) {
      const e = dragEvent(type, { types: ["text/plain"] });
      fire(el, e);
      expect(e.defaultPrevented).toBe(false);
    }
    const over = dragEvent("dragover", { types: ["text/plain"] });
    fire(el, over);
    expect(over.defaultPrevented).toBe(false);
    fire(el, dragEvent("dragenter", { noTransfer: true }));
    expect(result.current.dragging).toBe(false);
    fire(el, dragEvent("dragenter"));
    fire(el, dragEvent("drop", { files: [] }));
    expect(onFiles).not.toHaveBeenCalled();
    expect(result.current.dragging).toBe(false);
  });

  it("does nothing when disabled or when there is no element, and cleans up on unmount", () => {
    const el = document.createElement("div");
    const add = vi.spyOn(el, "addEventListener");
    const off = vi.spyOn(el, "removeEventListener");
    renderHook(() => useFileDrop(() => el, vi.fn(), false));
    renderHook(() => useFileDrop(() => null, vi.fn()));
    expect(add).not.toHaveBeenCalled();
    const { unmount } = renderHook(() => useFileDrop(() => el, vi.fn()));
    expect(add).toHaveBeenCalled();
    unmount();
    expect(off).toHaveBeenCalledTimes(4);
  });
});
