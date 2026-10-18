import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/server-page";
import { CHANNELS } from "@/lib/channels/catalog";
import { NOTIFICATION_KINDS } from "@/lib/notifications/registry";

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
