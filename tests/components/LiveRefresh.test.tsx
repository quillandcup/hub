// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

type Payload = { eventType: string; new: Record<string, unknown> | null };
let onChange: (p: Payload) => void = () => {};
let onStatus: (status: string) => void = () => {};
const removeChannel = vi.fn();
const setAuth = vi.fn(async () => {});
const calls: string[] = [];
const channel = {
  on: vi.fn((_type: string, _filter: unknown, cb: (p: Payload) => void) => {
    onChange = cb;
    return channel;
  }),
  subscribe: vi.fn((cb: (status: string) => void) => {
    calls.push("subscribe");
    onStatus = cb;
    return channel;
  }),
};
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => channel,
    removeChannel,
    auth: { getSession: async () => ({ data: { session: { access_token: "admin-token" } } }) },
    realtime: { setAuth: (...a: unknown[]) => (calls.push("setAuth"), setAuth(...(a as []))) },
  }),
}));

import LiveRefresh from "@/components/LiveRefresh";

const WEEK = { column: "start_time", from: "2026-11-01T05:00:00Z", to: "2026-11-08T05:00:00Z" };
const change = (start: string | null, eventType = "UPDATE"): Payload => ({ eventType, new: start ? { start_time: start } : null });

async function mount(opts: { unbounded?: boolean } = {}) {
  render(<LiveRefresh table="prickles" within={opts.unbounded ? undefined : WEEK} />);
  await act(async () => {}); // the session loads and the channel subscribes
}
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(600)));

describe("LiveRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    calls.length = 0;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("signs realtime in as the admin before it subscribes, to the table", async () => {
    await mount();
    expect(calls).toEqual(["setAuth", "subscribe"]);
    expect(channel.on).toHaveBeenCalledWith("postgres_changes", { event: "*", schema: "public", table: "prickles" }, expect.any(Function));
  });

  it("refreshes the page after a change inside the visible window, once for a burst", async () => {
    await mount();
    onChange(change("2026-11-03T15:00:00Z"));
    onChange(change("2026-11-04T15:00:00Z", "INSERT"));
    onChange(change("2026-11-05T15:00:00Z"));
    expect(refresh).not.toHaveBeenCalled();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("ignores changes outside the window (the end is not included)", async () => {
    await mount();
    onChange(change("2026-10-31T15:00:00Z"));
    onChange(change("2026-11-08T05:00:00Z"));
    await settle();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("counts a delete, which carries only the id, and any change when no window is given", async () => {
    await mount();
    onChange(change(null, "DELETE"));
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);

    cleanup();
    await mount({ unbounded: true });
    onChange(change("2030-01-01T00:00:00Z"));
    await settle();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("catches up after a reconnect, but not on the first connection", async () => {
    await mount();
    onStatus("SUBSCRIBED");
    await settle();
    expect(refresh).not.toHaveBeenCalled();

    onStatus("SUBSCRIBED");
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("logs a failed subscription instead of throwing, and stays quiet when closed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await mount();
    onStatus("CHANNEL_ERROR");
    onStatus("CLOSED");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("refreshes when the tab comes back to the front, and not while it is hidden", async () => {
    await mount();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    fireEvent(document, new Event("visibilitychange"));
    await settle();
    expect(refresh).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    fireEvent(document, new Event("visibilitychange"));
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);

    fireEvent(window, new Event("focus"));
    await settle();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("leaves the channel and drops a pending refresh when it unmounts", async () => {
    await mount();
    onChange(change("2026-11-03T15:00:00Z"));
    cleanup();
    await settle();
    expect(removeChannel).toHaveBeenCalledWith(channel);
    expect(refresh).not.toHaveBeenCalled();
  });
});
