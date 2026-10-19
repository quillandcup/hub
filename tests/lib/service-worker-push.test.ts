import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

/** Runs public/sw.js against a fake service worker scope and returns what it registered. */
function loadWorker(clients: Record<string, unknown> = {}, storage = new Map<string, string>(), storageError = false) {
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
    caches: { open: async () => {
      if (storageError) throw new Error("Storage denied");
      return {
        match: async (key: string) => storage.has(key) ? new Response(storage.get(key)) : undefined,
        put: async (key: string, response: Response) => { storage.set(key, await response.text()); },
      };
    } },
  };
  const source = fs.readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
  vm.runInNewContext(source, { self, URL, Response });
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
    const payload = { title: "Check in", body: "Starts soon", url: "/my-prickles", tag: "k:1" };
    const show = await push({ json: () => payload, text: () => JSON.stringify(payload) });

    expect(show).toHaveBeenCalledWith("Check in", {
      body: "Starts soon",
      tag: "k:1",
      renotify: true,
      data: { url: "/my-prickles", notificationId: expect.any(String) },
    });
  });

  it("never asks for a persistent alert on a push, even from an older payload that does", async () => {
    // Chrome shows a push-delivered requireInteraction alert but its click never reaches the worker.
    const payload = { title: "Check in", body: "Starts soon", url: "/my-prickles", requireInteraction: true };
    const show = await push({ json: () => payload, text: () => JSON.stringify(payload) });

    expect(show.mock.calls[0][1]).not.toHaveProperty("requireInteraction");
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

  it("focuses the tab once: Chrome denies a second focus() within one click", async () => {
    const focus = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error("Not allowed to focus a window"));
    const navigate = vi.fn().mockResolvedValue({ focus });
    const worker = loadWorker({ matchAll: async () => [{ url: `${origin}/dashboard`, focus, navigate }] });
    await fire(worker.listeners, "notificationclick", { notification: { data: { url: "/prickles/1/checkin" }, close: vi.fn() } });

    expect(focus).toHaveBeenCalledTimes(1);
    const stages = (await diagnostics(worker.listeners)).entries.map((e: any) => e.stage);
    expect(stages).toEqual(["click_received", "tab_navigated"]);
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

async function fire(listeners: Record<string, (event: any) => void>, type: string, event: any) {
  const waits: Promise<unknown>[] = [];
  listeners[type]({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
}

async function diagnostics(listeners: Record<string, (event: any) => void>) {
  const postMessage = vi.fn();
  await fire(listeners, "message", { data: { type: "PUSH_DIAGNOSTICS" }, ports: [{ postMessage }] });
  return postMessage.mock.calls[0][0];
}

describe("browser push click diagnostics", () => {
  it.each([
    ["standard", false],
    ["persistent", true],
  ] as const)("sends a local %s alert through the same worker click path", async (style, requireInteraction) => {
    const openWindow = vi.fn().mockResolvedValue(null);
    const worker = loadWorker({ matchAll: async () => [], openWindow });
    const postMessage = vi.fn();
    await fire(worker.listeners, "message", { data: { type: "PUSH_ALERT_COMPARISON", style }, ports: [{ postMessage }] });
    expect(worker.showNotification).toHaveBeenCalledWith(`[Test] ${style} browser alert`, expect.objectContaining({
      requireInteraction,
      data: { url: "/admin/notifications", notificationId: expect.any(String) },
    }));
    const id = postMessage.mock.calls[0][0].notificationId;
    const options = worker.showNotification.mock.calls[0][1];
    await fire(worker.listeners, "notificationclick", { notification: { data: options.data, close: vi.fn() } });
    const entries = (await diagnostics(worker.listeners)).entries;
    expect(entries.map((entry: any) => [entry.stage, entry.notificationId])).toEqual([
      ["shown", id], ["click_received", id], ["window_open_requested", id],
    ]);
    expect(entries[0].style).toBe(style);
    expect(openWindow).toHaveBeenCalledWith("https://hub.example.test/admin/notifications");
  });

  it("reports a local comparison alert that the browser refused to display", async () => {
    const worker = loadWorker();
    worker.showNotification.mockRejectedValue(new TypeError("Notification permission denied"));
    const postMessage = vi.fn();
    await fire(worker.listeners, "message", { data: { type: "PUSH_ALERT_COMPARISON", style: "standard" }, ports: [{ postMessage }] });
    expect(postMessage).toHaveBeenCalledWith({ error: "Notification permission denied" });
    expect((await diagnostics(worker.listeners)).entries).toHaveLength(0);
  });

  it("repeats a tagged persistent alert with the same tag and a fresh diagnostic ID", async () => {
    const worker = loadWorker();
    const first = vi.fn();
    const second = vi.fn();
    await fire(worker.listeners, "message", { data: { type: "PUSH_ALERT_COMPARISON", style: "tagged" }, ports: [{ postMessage: first }] });
    await fire(worker.listeners, "message", { data: { type: "PUSH_ALERT_COMPARISON", style: "tagged" }, ports: [{ postMessage: second }] });
    const calls = worker.showNotification.mock.calls;
    expect(calls).toHaveLength(2);
    for (const [, options] of calls) expect(options).toMatchObject({ tag: "prickle_checkin:comparison", renotify: true, requireInteraction: true });
    expect(first.mock.calls[0][0].notificationId).not.toBe(second.mock.calls[0][0].notificationId);
    const entries = (await diagnostics(worker.listeners)).entries;
    expect(entries.map((entry: any) => [entry.style, entry.tagged])).toEqual([["tagged", true], ["tagged", true]]);
  });

  it("correlates display and click across worker restarts, keeping destination paths without notification content", async () => {
    const storage = new Map<string, string>();
    const first = loadWorker({}, storage);
    await fire(first.listeners, "push", { data: { json: () => ({ title: "Private title", body: "Private body", url: "/my-prickles/history?checkin=secret-id#private-fragment" }) } });
    const data = first.showNotification.mock.calls[0][1].data;
    const second = loadWorker({ matchAll: async () => [], openWindow: vi.fn().mockResolvedValue(null) }, storage);
    await fire(second.listeners, "notificationclick", { notification: { data, close: vi.fn() } });
    const result = await diagnostics(second.listeners);
    expect(result.version).toBe("click-diagnostics-v4");
    expect(result.entries.map((e: any) => e.stage)).toEqual(["shown", "click_received", "window_open_requested"]);
    expect(result.entries.every((e: any) => e.notificationId === data.notificationId)).toBe(true);
    expect(result.entries.every((e: any) => e.pathname === "/my-prickles/history")).toBe(true);
    expect(result.entries.every((e: any) => e.version === "click-diagnostics-v4")).toBe(true);
    expect(result.entries.map((e: any) => e.operation)).toEqual(["show_notification", "receive_click", "open_window"]);
    expect(JSON.stringify(result)).not.toMatch(/Private|secret-id|private-fragment/);
  });

  it("records navigation errors and the click even when opening fails", async () => {
    const worker = loadWorker({ matchAll: vi.fn().mockRejectedValue(new TypeError("Cannot enumerate windows")) });
    await fire(worker.listeners, "notificationclick", { notification: { data: { url: "/test" }, close: vi.fn() } });
    const result = await diagnostics(worker.listeners);
    expect(result.entries.map((e: any) => e.stage)).toEqual(["click_received", "open_failed"]);
    expect(result.entries[1].error).toBe("TypeError");
    expect(result.entries[1].errorMessage).toBe("Cannot enumerate windows");
    expect(result.entries[1].operation).toBe("list_windows");
  });

  it("records tab navigation even if bringing the navigated window forward fails", async () => {
    const focus = vi.fn().mockRejectedValue(new TypeError("focus denied"));
    const navigate = vi.fn().mockResolvedValue({ focus });
    const worker = loadWorker({ matchAll: async () => [{ url: "https://hub.example.test/dashboard", navigate }] });
    await fire(worker.listeners, "notificationclick", { notification: { data: { url: "/test" }, close: vi.fn() } });
    expect((await diagnostics(worker.listeners)).entries.map((e: any) => e.stage)).toEqual(["click_received", "focus_failed", "tab_navigated"]);
  });

  it.each([
    ["Cannot open 'https://user:password@hub.example.test/my-prickles/history?token=secret#private'", "Cannot open '/my-prickles/history'"],
    ["Navigation to /my-prickles/history?token=secret#private failed", "Navigation to /my-prickles/history[redacted] failed"],
    ["Unable to focus a window", "Unable to focus a window"],
  ])("retains a useful sanitized error message: %s", async (message, expected) => {
    const worker = loadWorker({ matchAll: async () => [], openWindow: vi.fn().mockRejectedValue(new TypeError(message)) });
    await fire(worker.listeners, "notificationclick", { notification: { data: { url: "/target?secret=value#fragment" }, close: vi.fn() } });
    const result = await diagnostics(worker.listeners);
    expect(result.entries[1]).toMatchObject({
      stage: "open_failed", operation: "open_window", pathname: "/target", error: "TypeError", errorMessage: expected,
    });
    expect(JSON.stringify(result)).not.toMatch(/password|secret|private|fragment/);
  });

  it("bounds error message size without storing the stack", async () => {
    const worker = loadWorker({ matchAll: vi.fn().mockRejectedValue(new Error("x".repeat(1000))) });
    await fire(worker.listeners, "notificationclick", { notification: { data: { url: "/test" }, close: vi.fn() } });
    const entry = (await diagnostics(worker.listeners)).entries[1];
    expect(entry.errorMessage).toBe("x".repeat(500));
    expect(entry).not.toHaveProperty("stack");
  });

  it("distinguishes a tab focus failure from a tab navigation failure", async () => {
    const worker = loadWorker({ matchAll: async () => [
      { url: "https://hub.example.test/one", focus: vi.fn().mockRejectedValue(new Error("focus denied")) },
      { url: "https://hub.example.test/two", navigate: vi.fn().mockRejectedValue(new Error("navigation denied")) },
    ], openWindow: vi.fn().mockResolvedValue(null) });
    await fire(worker.listeners, "notificationclick", { notification: { data: { url: "/target" }, close: vi.fn() } });
    expect((await diagnostics(worker.listeners)).entries.filter((e: any) => e.stage === "tab_reuse_failed")).toMatchObject([
      { operation: "focus_tab", errorMessage: "focus denied" },
      { operation: "navigate_tab", errorMessage: "navigation denied" },
    ]);
  });

  it("preserves the earlier fix for a synchronous focus failure after navigation", async () => {
    const focus = vi.fn(() => { throw new TypeError("closed window"); });
    const navigate = vi.fn().mockResolvedValue({ focus });
    const otherNavigate = vi.fn();
    const openWindow = vi.fn();
    const worker = loadWorker({ matchAll: async () => [
      { url: "https://hub.example.test/dashboard", navigate },
      { url: "https://hub.example.test/members", navigate: otherNavigate },
    ], openWindow });
    await fire(worker.listeners, "notificationclick", { notification: { data: { url: "/test" }, close: vi.fn() } });
    expect(navigate).toHaveBeenCalledOnce();
    expect(otherNavigate).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
    expect((await diagnostics(worker.listeners)).entries.map((e: any) => e.stage)).toEqual(["click_received", "focus_failed", "tab_navigated"]);
  });

  it("retains only the latest 30 events", async () => {
    const worker = loadWorker();
    for (let i = 0; i < 35; i++) await fire(worker.listeners, "push", { data: null });
    expect((await diagnostics(worker.listeners)).entries).toHaveLength(30);
  });

  it("opens the notification even when diagnostic storage is unavailable", async () => {
    const openWindow = vi.fn().mockResolvedValue(null);
    const worker = loadWorker({ matchAll: async () => [], openWindow }, new Map(), true);
    await fire(worker.listeners, "notificationclick", { notification: { data: { url: "/test" }, close: vi.fn() } });
    expect(openWindow).toHaveBeenCalledWith("https://hub.example.test/test");
    expect(await diagnostics(worker.listeners)).toEqual({ error: "This browser cannot store notification diagnostics." });
  });
});
