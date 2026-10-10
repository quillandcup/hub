import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "@/tests/helpers/server-page";
import { APP_URL, SUPPORT_EMAIL } from "@/lib/config";

let serviceFake: FakeSupabase;
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => serviceFake }));
vi.mock("@/lib/slack-member-ids", () => ({ resolveSlackUserIds: async () => new Map() }));
vi.mock("@/lib/slack", () => ({ sendSlackDM: vi.fn() }));

const sendNotification = vi.hoisted(() => vi.fn());
vi.mock("web-push", () => {
  class WebPushError extends Error {
    constructor(
      message: string,
      public statusCode: number,
      public headers: object,
      public body: string,
      public endpoint: string
    ) {
      super(message);
    }
  }
  return { default: { sendNotification }, WebPushError };
});

const { WebPushError } = await import("web-push");
const { pushPayload, ttlSeconds, webPushChannel } = await import("@/lib/channels/web-push");
const { createNotifier } = await import("@/lib/notifications/notify");

const NOW = Date.parse("2026-10-14T12:00:00Z");
const flag = { feature_flags: { data: { enabled_globally: true } }, members: { data: [{ id: "m1", user_id: "u1" }] } };
const callsOf = (table: string) => serviceFake.queries.filter((q) => q.table === table).flatMap((q) => q.calls);

beforeEach(() => {
  sendNotification.mockReset();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-key");
  vi.stubEnv("VAPID_PRIVATE_KEY", "private-key");
});
afterEach(() => vi.unstubAllEnvs());

describe("web_push resolveAddresses", () => {
  it("reaches flagged members who have a live subscription", async () => {
    const fake = createFakeSupabase({ ...flag, push_subscriptions: { data: [{ member_id: "m1" }] } });
    expect(await webPushChannel.resolveAddresses(fake, ["m1", "m2"])).toEqual(new Map([["m1", "m1"]]));
    const calls = fake.queries.find((q) => q.table === "push_subscriptions")!.calls;
    expect(calls).toContainEqual({ method: "is", args: ["deleted_at", null] });
    expect(calls).toContainEqual({ method: "in", args: ["member_id", ["m1"]] });
  });

  it("reaches nobody without the flag, or without the VAPID keys", async () => {
    const unflagged = createFakeSupabase({ push_subscriptions: { data: [{ member_id: "m1" }] } });
    expect(await webPushChannel.resolveAddresses(unflagged, ["m1"])).toEqual(new Map());

    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const fake = createFakeSupabase({ ...flag, push_subscriptions: { data: [{ member_id: "m1" }] } });
    expect(await webPushChannel.resolveAddresses(fake, ["m1"])).toEqual(new Map());
    expect(fake.queries).toEqual([]);
  });
});

describe("pushPayload and ttlSeconds", () => {
  it("titles with the kind, links to a Hub path, and tags by what it's about", () => {
    const payload = pushPayload(
      { text: "Check in", url: `${APP_URL}/prickles/p1`, ref: "p1" },
      { kind: "prickle_checkin" },
      NOW
    );
    expect(payload).toEqual({
      title: "Prickle check-ins",
      body: "Check in",
      url: "/prickles/p1",
      tag: "prickle_checkin:p1",
      requireInteraction: false,
    });
  });

  it("falls back to the Hub home for a link that isn't ours", () => {
    expect(pushPayload({ text: "x", url: "https://example.com/y" }, { kind: "prickle_checkin" }, NOW).url).toBe("/");
  });

  it("expires a time-sensitive push when it stops mattering, and keeps others a day", () => {
    const soon = new Date(NOW + 20 * 60_000).toISOString();
    expect(ttlSeconds({ text: "x", timeSensitiveUntil: soon }, NOW)).toBe(20 * 60);
    expect(pushPayload({ text: "x", timeSensitiveUntil: soon }, { kind: "prickle_checkin" }, NOW).requireInteraction).toBe(true);

    const past = new Date(NOW - 1000).toISOString();
    expect(ttlSeconds({ text: "x", timeSensitiveUntil: past }, NOW)).toBe(24 * 60 * 60);
    expect(ttlSeconds({ text: "x" }, NOW)).toBe(24 * 60 * 60);
  });
});

describe("web_push send", () => {
  const SUBS = {
    push_subscriptions: {
      data: [
        { id: "s1", member_id: "m1", endpoint: "https://push.example.test/1", p256dh: "k1", auth: "a1" },
        { id: "s2", member_id: "m1", endpoint: "https://push.example.test/2", p256dh: "k2", auth: "a2" },
      ],
    },
  };

  it("sends to every device with VAPID details and a payload, and stamps the ones it reached", async () => {
    serviceFake = createFakeSupabase(SUBS);
    sendNotification.mockResolvedValue({ statusCode: 201 });
    await webPushChannel.send("m1", { text: "Hello" }, { kind: "prickle_checkin" });

    expect(sendNotification).toHaveBeenCalledTimes(2);
    const [subscription, body, options] = sendNotification.mock.calls[0];
    expect(subscription).toEqual({ endpoint: "https://push.example.test/1", keys: { p256dh: "k1", auth: "a1" } });
    expect(JSON.parse(body).body).toBe("Hello");
    expect(options.vapidDetails).toEqual({
      subject: `mailto:${SUPPORT_EMAIL}`,
      publicKey: "public-key",
      privateKey: "private-key",
    });
    const update = callsOf("push_subscriptions").find((c) => c.method === "update")!;
    expect(update.args[0]).toEqual({ last_sent_at: expect.any(String) });
  });

  it("soft-deletes a subscription the push service says is gone, and still succeeds for the others", async () => {
    serviceFake = createFakeSupabase(SUBS);
    sendNotification
      .mockRejectedValueOnce(new WebPushError("gone", 410, {}, "", "https://push.example.test/1"))
      .mockResolvedValueOnce({ statusCode: 201 });
    await expect(webPushChannel.send("m1", { text: "Hello" }, { kind: "prickle_checkin" })).resolves.toBeUndefined();

    const updates = callsOf("push_subscriptions").filter((c) => c.method === "update");
    expect(updates.map((c) => c.args[0])).toContainEqual({ deleted_at: expect.any(String) });
    expect(callsOf("push_subscriptions")).toContainEqual({ method: "in", args: ["id", ["s1"]] });
  });

  it("throws when no device could be reached for a reason that might pass", async () => {
    serviceFake = createFakeSupabase(SUBS);
    sendNotification.mockRejectedValue(new WebPushError("unavailable", 503, {}, "try later", "https://push.example.test/1"));
    await expect(webPushChannel.send("m1", { text: "Hello" }, { kind: "prickle_checkin" })).rejects.toThrow("503");
  });

  it("goes out through createNotifier alongside the member's other channels", async () => {
    serviceFake = createFakeSupabase({ ...flag, ...SUBS });
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const notifier = await createNotifier(serviceFake, "prickle_checkin", ["m1"], { channels: ["web_push"] });
    expect(notifier.canReach("m1")).toBe(true);
    expect(await notifier.send("m1", { text: "Hello" })).toEqual(["web_push"]);
  });
});
