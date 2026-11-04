// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { StaleTabReload, isStaleActionError } from "@/components/StaleTabReload";

const reload = vi.fn();

function reject(reason: unknown) {
  const event = new Event("unhandledrejection") as Event & { reason?: unknown };
  event.reason = reason;
  window.dispatchEvent(event);
}

const staleAction = () => Object.assign(new Error('Server Action "abc" was not found on the server.'), { name: "UnrecognizedActionError" });

beforeEach(() => {
  window.sessionStorage.clear();
  vi.stubGlobal("location", { ...window.location, reload });
});

afterEach(() => {
  cleanup();
  reload.mockReset();
  vi.unstubAllGlobals();
});

describe("isStaleActionError", () => {
  it("knows Next's refused-action error by name or message, and nothing else", () => {
    expect(isStaleActionError(staleAction())).toBe(true);
    expect(isStaleActionError(new Error('Server Action "x" was not found on the server.'))).toBe(true);
    expect(isStaleActionError(new Error("boom"))).toBe(false);
    expect(isStaleActionError(null)).toBe(false);
  });
});

describe("StaleTabReload", () => {
  it("reloads a tab whose server action the new deployment doesn't have", () => {
    render(<StaleTabReload />);
    reject(staleAction());
    expect(reload).toHaveBeenCalledOnce();
  });

  it("leaves other errors alone", () => {
    render(<StaleTabReload />);
    reject(new Error("boom"));
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads at most once a minute, so a server that keeps refusing can't loop the tab", () => {
    render(<StaleTabReload />);
    reject(staleAction());
    reject(staleAction());
    expect(reload).toHaveBeenCalledOnce();
  });

  it("stops listening when it unmounts", () => {
    const { unmount } = render(<StaleTabReload />);
    unmount();
    reject(staleAction());
    expect(reload).not.toHaveBeenCalled();
  });
});
