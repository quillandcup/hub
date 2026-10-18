import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

/** Runs public/sw.js against a fake service worker scope and returns what it registered. */
function loadWorker(clients: Record<string, unknown> = {}) {
  const listeners: Record<string, (event: any) => void> = {};
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const self = {
    addEventListener: (type: string, listener: (event: any) => void) => {
      listeners[type] = listener;
    },
    registration: { showNotification },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(), ...clients },
    location: { origin: "https://hub.example.test" },
  };
  const source = fs.readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
  vm.runInNewContext(source, { self, URL });
  return { listeners, showNotification };
}

/** Fires the push handler and returns what it passed to showNotification. */
async function push(data: { json: () => unknown; text: () => string } | null) {
  const { listeners, showNotification } = loadWorker();
  const waits: Promise<unknown>[] = [];
  listeners.push({ data, waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
  return showNotification;
}

describe("public/sw.js push handler", () => {
  it("shows the title, body and url from a JSON payload", async () => {
    const payload = { title: "Check in", body: "Starts soon", url: "/my-prickles", tag: "k:1", requireInteraction: true };
    const show = await push({ json: () => payload, text: () => JSON.stringify(payload) });

    expect(show).toHaveBeenCalledWith("Check in", {
      body: "Starts soon",
      tag: "k:1",
      renotify: true,
      requireInteraction: true,
      data: { url: "/my-prickles" },
    });
  });

  it("shows plain text as the body instead of dropping it", async () => {
    const show = await push({
      json: () => {
        throw new SyntaxError("not JSON");
      },
      text: () => "Test push message from DevTools.",
    });

    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0][0]).toBe("Notification");
    expect(show.mock.calls[0][1]).toMatchObject({ body: "Test push message from DevTools." });
  });

  it("still shows something for a push with no data", async () => {
    const show = await push(null);

    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0][0]).toBe("Notification");
  });

  it("uses a generic title when the payload has none", async () => {
    const show = await push({ json: () => ({ body: "Hello" }), text: () => "" });

    expect(show.mock.calls[0][0]).toBe("Notification");
    expect(show.mock.calls[0][1]).toMatchObject({ body: "Hello" });
  });

  it("treats a JSON value that isn't an object as the body", async () => {
    const show = await push({ json: () => "just a string", text: () => "" });

    expect(show.mock.calls[0][0]).toBe("Notification");
    expect(show.mock.calls[0][1]).toMatchObject({ body: "just a string" });
  });
});

/** Fires the click handler with the given open windows and returns what it did. */
async function click(windows: any[], url = "/prickles/1/checkin") {
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const { listeners } = loadWorker({ matchAll: vi.fn().mockResolvedValue(windows), openWindow });
  const close = vi.fn();
  const waits: Promise<unknown>[] = [];
  listeners.notificationclick({ notification: { close, data: { url } }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
  return { openWindow, close };
}

describe("public/sw.js notification click handler", () => {
  const origin = "https://hub.example.test";

  it("opens a window at the url when no Hub tab is open", async () => {
    const { openWindow, close } = await click([]);

    expect(close).toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith(`${origin}/prickles/1/checkin`);
  });

  it("navigates and focuses an open Hub tab", async () => {
    const focus = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn().mockResolvedValue({ focus });
    const { openWindow } = await click([{ url: `${origin}/dashboard`, navigate }]);

    expect(navigate).toHaveBeenCalledWith(`${origin}/prickles/1/checkin`);
    expect(focus).toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("still navigates a tab whose url reads as the target, since the Hub navigates in place", async () => {
    const focus = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn().mockResolvedValue({ focus });
    const { openWindow } = await click([{ url: `${origin}/prickles/1/checkin`, navigate, focus }]);

    expect(focus).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(`${origin}/prickles/1/checkin`);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("never navigates the service worker's own source tab", async () => {
    const navigate = vi.fn();
    const { openWindow } = await click([{ url: `${origin}/sw.js`, navigate }]);

    expect(navigate).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith(`${origin}/prickles/1/checkin`);
  });

  it("opens a new window when the open tab can't be navigated", async () => {
    const navigate = vi.fn().mockRejectedValue(new TypeError("uncontrolled client"));
    const { openWindow } = await click([{ url: `${origin}/dashboard`, navigate }]);

    expect(openWindow).toHaveBeenCalledWith(`${origin}/prickles/1/checkin`);
  });

  it("tries the next Hub tab when the first can't be focused", async () => {
    const stale = { url: `${origin}/dashboard`, focus: vi.fn().mockRejectedValue(new Error("Not allowed to focus a window")), navigate: vi.fn() };
    const focus = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn().mockResolvedValue({ focus });
    const { openWindow } = await click([stale, { url: `${origin}/members`, navigate }]);

    expect(navigate).toHaveBeenCalledWith(`${origin}/prickles/1/checkin`);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("prefers a tab already on the url", async () => {
    const other = { url: `${origin}/dashboard`, focus: vi.fn(), navigate: vi.fn() };
    const exact = { url: `${origin}/prickles/1/checkin`, focus: vi.fn().mockResolvedValue(undefined), navigate: vi.fn().mockResolvedValue({ focus: vi.fn() }) };
    await click([other, exact]);

    expect(exact.focus).toHaveBeenCalled();
    expect(other.focus).not.toHaveBeenCalled();
  });

  it("opens an https link on another origin (the server only sends allowed ones) in a new window", async () => {
    const { openWindow } = await click([], "https://workspace.example.test/app_redirect?channel=C1");

    expect(openWindow).toHaveBeenCalledWith("https://workspace.example.test/app_redirect?channel=C1");
  });

  it("ignores a url that isn't https on another origin", async () => {
    const { openWindow } = await click([], "http://evil.example.test/x");

    expect(openWindow).not.toHaveBeenCalled();
  });
});
