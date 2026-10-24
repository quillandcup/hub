import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/server-page";
import { CHANNELS } from "@/lib/channels/catalog";
import { NOTIFICATION_KINDS } from "@/lib/notifications/registry";
import fs from "node:fs";
import vm from "node:vm";
import { pushPayload } from "@/lib/channels/web-push";

const mocks = vi.hoisted(() => ({
  addresses: new Map<string, string>(),
  send: vi.fn(async (_address: string, _message: any, _context: any) => {}),
  introChannel: vi.fn(async () => "CSTART" as string | null),
}));

vi.mock("@/lib/channels", async () => {
  const catalog = await import("@/lib/channels/catalog");
  const adapter = (id: string) => ({
    id,
    resolveAddresses: async () => (mocks.addresses.has(id) ? new Map([["m1", mocks.addresses.get(id)!]]) : new Map()),
    send: (address: string, message: any, context: any) => mocks.send(address, { ...message, channel: id }, context),
  });
  return {
    CHANNELS: catalog.CHANNELS,
    CHANNEL_ADAPTERS: Object.fromEntries(catalog.CHANNELS.map((c) => [c.id, adapter(c.id)])),
  };
});
vi.mock("@/lib/newcomer-signals", () => ({ loadIntroChannelId: mocks.introChannel }));

import { sampleMessages, sendTestNotification, UNREACHABLE_REASON } from "@/lib/notification-test";

const NOW = new Date("2026-10-18T15:00:00Z");
const prickle = {
  id: "p1",
  start_time: "2026-10-19T13:00:00Z",
  end_time: "2026-10-19T14:00:00Z",
  prickle_types: { name: "Pomodoro" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.addresses.clear();
  mocks.addresses.set("slack", "U1");
  mocks.addresses.set("in_app", "m1");
  mocks.addresses.set("web_push", "m1");
  mocks.addresses.set("email", "a@example.test");
});

describe("sampleMessages", () => {
  it.each(NOTIFICATION_KINDS.map((k) => k.id))("builds a sample for %s that's marked as a test", async (kind) => {
    const messages = await sampleMessages(createFakeSupabase({ prickles: { data: [prickle] } }), kind, NOW);

    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) expect(message.text.startsWith("[Test] ")).toBe(true);
  });

  it.each(NOTIFICATION_KINDS.map((k) => k.id))("builds %s as a member receives it with { test: false }: no test marker anywhere", async (kind) => {
    const messages = await sampleMessages(createFakeSupabase({ prickles: { data: [prickle] } }), kind, NOW, { test: false });

    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(JSON.stringify(message)).not.toMatch(/\[Test\]|Test send/);
      expect(message.title ?? "").not.toMatch(/^\[Test\]/);
    }
  });

  it("builds both Big Sister versions: to the new member and to the Big Sister", async () => {
    const messages = await sampleMessages(createFakeSupabase(), "big_sister_match", NOW);

    expect(messages.map((m) => m.title)).toEqual([
      "[Test] Meet your new Big Sister in the Hedgie House!",
      "[Test] You're a Big Sister, Marlow! You have a new member to welcome 💖",
    ]);
  });

  it("links the intro reminder to the #start-here channel", async () => {
    const [message] = await sampleMessages(createFakeSupabase(), "intro_nudge", NOW);

    expect(message.url).toContain("channel=CSTART");
  });

  it("uses the next prickle for a check-in, so its link and text are real", async () => {
    const [message] = await sampleMessages(createFakeSupabase({ prickles: { data: [prickle] } }), "prickle_checkin", NOW);

    expect(message.text).toContain("Pomodoro");
    expect(message.url).toContain("p1");
  });

  it("falls back to a stand-in prickle when there are none", async () => {
    const [message] = await sampleMessages(createFakeSupabase({ prickles: { data: [] } }), "prickle_checkout", NOW);

    expect(message.text).toContain("Sprint Prickle");
  });
});

describe("sendTestNotification", () => {
  it("wires the actual Browser check-in sample to the worker's click handler and diagnostic entry", async () => {
    await sendTestNotification(createFakeSupabase({ prickles: { data: [prickle] } }), "m1", "prickle_checkin", "web_push", NOW);
    const [, message, context] = mocks.send.mock.calls[0];
    expect(message.text).toMatch(/^\[Test\]/);
    const payload = JSON.parse(JSON.stringify(pushPayload(message, context, NOW.getTime())));
    expect(payload.url).toBe("/my-prickles/history?checkin=p1");

    const listeners: Record<string, (event: any) => void> = {};
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const openWindow = vi.fn().mockResolvedValue(null);
    let stored = "[]";
    const self = {
      addEventListener: (type: string, listener: (event: any) => void) => { listeners[type] = listener; },
      location: { origin: new URL(message.url).origin },
      registration: { showNotification },
      clients: { matchAll: async () => [], openWindow },
      caches: { open: async () => ({
        match: async () => new Response(stored),
        put: async (_key: string, response: Response) => { stored = await response.text(); },
      }) },
    };
    vm.runInNewContext(fs.readFileSync("public/sw.js", "utf8"), { self, URL, Response });
    async function fire(type: string, event: any) {
      const waits: Promise<unknown>[] = [];
      listeners[type]({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
      await Promise.all(waits);
    }
    await fire("push", { data: { json: () => payload } });
    const options = showNotification.mock.calls[0][1];
    expect(options.data.url).toBe(payload.url);
    expect(JSON.parse(stored).map((entry: any) => entry.stage)).toEqual(["shown"]);

    // The browser supplies the displayed notification's data when dispatching a native click.
    await fire("notificationclick", { notification: { data: options.data, close: vi.fn() } });
    const entries = JSON.parse(stored);
    expect(entries.map((entry: any) => entry.stage)).toEqual(["shown", "click_received", "window_open_requested"]);
    expect(entries.every((entry: any) => entry.notificationId === options.data.notificationId)).toBe(true);
    expect(openWindow).toHaveBeenCalledWith(new URL(payload.url, self.location.origin).href);
  });

  it("sends the sample on the chosen channel only, as that kind, to the member's address", async () => {
    const result = await sendTestNotification(createFakeSupabase(), "m1", "prickle_nudge", "email", NOW);

    expect(result).toEqual({ ok: true, sent: 1 });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const [address, message, context] = mocks.send.mock.calls[0];
    expect(address).toBe("a@example.test");
    expect(message.channel).toBe("email");
    expect(message.footerLinks).toEqual([expect.objectContaining({ label: "Notification settings" })]);
    expect(context).toEqual({ kind: "prickle_nudge", memberId: "m1" });
  });

  it("sends every message of a kind that has more than one", async () => {
    expect(await sendTestNotification(createFakeSupabase(), "m1", "big_sister_match", "in_app", NOW)).toEqual({ ok: true, sent: 2 });
  });

  it.each(CHANNELS.map((c) => c.id))("says why %s can't reach the member, and sends nothing", async (channel) => {
    mocks.addresses.delete(channel);

    const result = await sendTestNotification(createFakeSupabase(), "m1", "intro_nudge", channel, NOW);

    expect(result).toEqual({ ok: false, error: UNREACHABLE_REASON[channel] });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("reports the channel's own failure instead of swallowing it", async () => {
    mocks.send.mockRejectedValueOnce(new Error("Resend responded 403"));

    const result = await sendTestNotification(createFakeSupabase(), "m1", "intro_nudge", "email", NOW);

    expect(result).toEqual({ ok: false, error: "Email failed: Resend responded 403" });
  });
});
