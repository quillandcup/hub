import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

/** Runs public/sw.js against a fake service worker scope and returns what it registered. */
function loadWorker() {
  const listeners: Record<string, (event: any) => void> = {};
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const self = {
    addEventListener: (type: string, listener: (event: any) => void) => {
      listeners[type] = listener;
    },
    registration: { showNotification },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
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
