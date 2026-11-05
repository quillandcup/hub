// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppUpdatedBar, { AWAY_AFTER_MS, isStaleActionError } from "@/components/announcements/AppUpdatedBar";

const reload = vi.fn();

function reject(reason: unknown) {
  const event = new Event("unhandledrejection") as Event & { reason?: unknown };
  event.reason = reason;
  act(() => {
    window.dispatchEvent(event);
  });
}

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

const staleAction = () => Object.assign(new Error('Server Action "abc" was not found on the server.'), { name: "UnrecognizedActionError" });

beforeEach(() => {
  window.sessionStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
  vi.stubGlobal("location", { ...window.location, reload });
  setVisibility("visible");
});

afterEach(() => {
  cleanup();
  reload.mockReset();
  vi.useRealTimers();
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

describe("AppUpdatedBar", () => {
  it("shows nothing until there is a reason", () => {
    render(<AppUpdatedBar />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("says the click didn't go through when an action is refused, and reloads only when asked", async () => {
    render(<AppUpdatedBar />);
    reject(staleAction());
    expect(screen.getByRole("status")).toHaveTextContent("didn't go through because the Hub was updated");
    expect(reload).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("ignores other errors", () => {
    render(<AppUpdatedBar />);
    reject(new Error("boom"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("warns a tab that comes back after 12 hours in the background, and lets it be dismissed", async () => {
    render(<AppUpdatedBar />);
    setVisibility("hidden");
    vi.setSystemTime(Date.now() + AWAY_AFTER_MS);
    setVisibility("visible");
    expect(await screen.findByText(/may have been updated/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("leaves a tab alone that was away for less than 12 hours", () => {
    render(<AppUpdatedBar />);
    setVisibility("hidden");
    vi.setSystemTime(Date.now() + AWAY_AFTER_MS - 1);
    setVisibility("visible");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps the failed-action message when the tab also comes back after a long time", () => {
    render(<AppUpdatedBar />);
    reject(staleAction());
    setVisibility("hidden");
    vi.setSystemTime(Date.now() + AWAY_AFTER_MS);
    setVisibility("visible");
    expect(screen.getByRole("status")).toHaveTextContent("didn't go through");
    expect(screen.queryByRole("button", { name: "Not now" })).not.toBeInTheDocument();
  });

  it("stops listening when it unmounts", () => {
    const { unmount } = render(<AppUpdatedBar />);
    unmount();
    reject(staleAction());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
