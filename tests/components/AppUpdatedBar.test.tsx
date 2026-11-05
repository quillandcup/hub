// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppUpdatedBar, { CHECK_EVERY_MS, isStaleActionError } from "@/components/announcements/AppUpdatedBar";
import { WARN_BEFORE_MS } from "@/lib/skew-deadline";

const reload = vi.fn();

const DAY_MS = 24 * 60 * 60 * 1000;
const BUILT = new Date("2026-11-01T12:00:00Z");
/** The first moment the notice shows for a build with a 7 day maximum age. */
const NOTICE_AT = BUILT.getTime() + 7 * DAY_MS - WARN_BEFORE_MS;

function reject(reason: unknown) {
  const event = new Event("unhandledrejection") as Event & { reason?: unknown };
  event.reason = reason;
  act(() => {
    window.dispatchEvent(event);
  });
}

function comeBackToFront() {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

const staleAction = () => Object.assign(new Error('Server Action "abc" was not found on the server.'), { name: "UnrecognizedActionError" });

beforeEach(() => {
  window.sessionStorage.clear();
  vi.stubEnv("BUILD_TIME", BUILT.toISOString());
  vi.stubEnv("SKEW_PROTECTION_MAX_AGE_SECONDS", String(7 * 24 * 60 * 60));
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(BUILT.getTime() + DAY_MS);
  vi.stubGlobal("location", { ...window.location, reload });
});

afterEach(() => {
  cleanup();
  reload.mockReset();
  vi.useRealTimers();
  vi.unstubAllEnvs();
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
  it("shows nothing on a young page", () => {
    render(<AppUpdatedBar />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("asks a page near its deployment's deadline to reload when its work is done, and reloads only when asked", async () => {
    vi.setSystemTime(NOTICE_AT);
    render(<AppUpdatedBar />);
    expect(screen.getByRole("status")).toHaveTextContent("submit any work first");
    expect(reload).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("waits until the notice window opens, to the millisecond", () => {
    vi.setSystemTime(NOTICE_AT - 1);
    render(<AppUpdatedBar />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("notices when a left-open tab gets old, on the timer and when it comes back to the front", () => {
    vi.setSystemTime(NOTICE_AT - CHECK_EVERY_MS);
    render(<AppUpdatedBar />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(CHECK_EVERY_MS);
    });
    expect(screen.getByRole("status")).toHaveTextContent("likely been updated");
  });

  it("checks at once when the tab comes back to the front", () => {
    render(<AppUpdatedBar />);
    vi.setSystemTime(NOTICE_AT + 1);
    comeBackToFront();
    expect(screen.getByRole("status")).toHaveTextContent("likely been updated");
  });

  it("can be put off for the session", async () => {
    vi.setSystemTime(NOTICE_AT);
    render(<AppUpdatedBar />);
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("never warns a build that doesn't know its time or the maximum age (local, tests)", () => {
    vi.stubEnv("BUILD_TIME", "");
    vi.setSystemTime(NOTICE_AT + 100 * DAY_MS);
    render(<AppUpdatedBar />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("says the click didn't go through when an action is refused anyway", async () => {
    render(<AppUpdatedBar />);
    reject(staleAction());
    expect(screen.getByRole("status")).toHaveTextContent("didn't go through because the Hub was updated");
    expect(screen.getByRole("status")).toHaveTextContent("What you typed is still on this page");
    expect(reload).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("keeps the failed-action message when the page also gets old, and can't be put off", () => {
    render(<AppUpdatedBar />);
    reject(staleAction());
    vi.setSystemTime(NOTICE_AT);
    comeBackToFront();
    expect(screen.getByRole("status")).toHaveTextContent("didn't go through");
    expect(screen.queryByRole("button", { name: "Not now" })).not.toBeInTheDocument();
  });

  it("ignores other errors", () => {
    render(<AppUpdatedBar />);
    reject(new Error("boom"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stops listening and checking when it unmounts", () => {
    const { unmount } = render(<AppUpdatedBar />);
    unmount();
    reject(staleAction());
    vi.setSystemTime(NOTICE_AT);
    act(() => {
      vi.advanceTimersByTime(CHECK_EVERY_MS);
    });
    comeBackToFront();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
