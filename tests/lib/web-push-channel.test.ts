import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import type { PushSubscriptionRow } from "@/lib/data/push-subscriptions";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import { APP_URL, SLACK_WORKSPACE_URL, SUPPORT_EMAIL } from "@/lib/config";

// Members, flags and devices live in one set of in-memory repositories (the channel's own service-role ones are the same).
let repos: Repos;
let dataset: InMemoryDataset;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
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
const FLAG = { feature_key: "browser_notifications", enabled_globally: true, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
const sub = (id: string, over: Partial<PushSubscriptionRow> = {}): PushSubscriptionRow => ({
  id,
  memberId: "m1",
  endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
  p256dh: `k-${id}`,
  auth: `a-${id}`,
  userAgent: null,
  createdAt: "2026-10-01T00:00:00Z",
  lastSentAt: null,
  pausedAt: null,
  disabledAt: null,
  deletedAt: null,
  ...over,
});
const world = (seed: ConstructorParameters<typeof InMemoryDataset>[0] = {}) => {
  dataset = new InMemoryDataset({ members: [{ id: "m1", name: "Ada Example", userId: "u1" }], ...seed });
  repos = createInMemoryRepos(dataset);
  return repos;
};
const flagged = (pushSubscriptions: PushSubscriptionRow[] = []) => world({ featureFlags: [FLAG], pushSubscriptions });

beforeEach(() => {
  sendNotification.mockReset();
  world();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-key");
  vi.stubEnv("VAPID_PRIVATE_KEY", "private-key");
});
afterEach(() => vi.unstubAllEnvs());

describe("web_push resolveAddresses", () => {
  it("reaches flagged members who have a live subscription", async () => {
    const r = flagged([sub("s1"), sub("gone", { memberId: "m2", deletedAt: "2026-10-02T00:00:00Z" }), sub("paused", { memberId: "m3", pausedAt: "2026-10-02T00:00:00Z" })]);
    dataset.members.push({ id: "m2", name: "Bea Example", userId: "u2" }, { id: "m3", name: "Cy Example", userId: "u3" });
    expect(await webPushChannel.resolveAddresses(r, ["m1", "m2", "m3", "m4"])).toEqual(new Map([["m1", "m1"]]));
  });

  it("reaches nobody without the flag, or without the VAPID keys", async () => {
    const unflagged = world({ pushSubscriptions: [sub("s1")] });
    expect(await webPushChannel.resolveAddresses(unflagged, ["m1"])).toEqual(new Map());

    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const r = flagged([sub("s1")]);
    const live = vi.spyOn(r.pushSubscriptions, "membersWithLive");
    expect(await webPushChannel.resolveAddresses(r, ["m1"])).toEqual(new Map());
    expect(live).not.toHaveBeenCalled();
  });
});

describe("pushPayload and ttlSeconds", () => {
  it("titles with the kind, links to a Hub path, and tags by what it's about", () => {
    const payload = pushPayload(
      { text: "Check in", url: `${APP_URL}/prickles/p1`, ref: "p1" },
      { kind: "prickle_checkin", memberId: "m1" },
      NOW
    );
    expect(payload).toEqual({
      title: "Prickle check-ins",
      body: "Check in",
      url: "/prickles/p1",
      tag: "prickle_checkin:p1",
    });
  });

  it("keeps a Slack workspace link, so tapping the push opens Slack", () => {
    const url = `${SLACK_WORKSPACE_URL}/app_redirect?channel=C1`;
    expect(pushPayload({ text: "x", url }, { kind: "intro_nudge", memberId: "m1" }, NOW).url).toBe(url);
  });

  it("falls back to the Hub home for a link that isn't ours", () => {
    expect(pushPayload({ text: "x", url: "https://example.com/y" }, { kind: "prickle_checkin", memberId: "m1" }, NOW).url).toBe("/");
  });

  it("expires a time-sensitive push when it stops mattering, and keeps others a day", () => {
    const soon = new Date(NOW + 20 * 60_000).toISOString();
    expect(ttlSeconds({ text: "x", timeSensitiveUntil: soon }, NOW)).toBe(20 * 60);
    expect(pushPayload({ text: "x", timeSensitiveUntil: soon }, { kind: "prickle_checkin", memberId: "m1" }, NOW)).not.toHaveProperty("requireInteraction");

    const past = new Date(NOW - 1000).toISOString();
    expect(ttlSeconds({ text: "x", timeSensitiveUntil: past }, NOW)).toBe(24 * 60 * 60);
    expect(ttlSeconds({ text: "x" }, NOW)).toBe(24 * 60 * 60);
  });
});

describe("web_push send", () => {
  const SUBS = () => [sub("s1"), sub("s2")];
  const deleted = () => dataset.pushSubscriptions.filter((p) => p.deletedAt).map((p) => p.id);
  const send = () => webPushChannel.send("m1", { text: "Hello" }, { kind: "prickle_checkin", memberId: "m1" });

  it("sends to every device with VAPID details and a payload, and stamps the ones it reached", async () => {
    flagged(SUBS());
    sendNotification.mockResolvedValue({ statusCode: 201 });
    await send();

    expect(sendNotification).toHaveBeenCalledTimes(2);
    const [subscription, body, options] = sendNotification.mock.calls[0];
    expect(subscription).toEqual({ endpoint: "https://fcm.googleapis.com/fcm/send/s1", keys: { p256dh: "k-s1", auth: "a-s1" } });
    expect(JSON.parse(body).body).toBe("Hello");
    expect(options.vapidDetails).toEqual({
      subject: `mailto:${SUPPORT_EMAIL}`,
      publicKey: "public-key",
      privateKey: "private-key",
    });
    expect(dataset.pushSubscriptions.map((p) => p.lastSentAt)).toEqual([expect.any(String), expect.any(String)]);
  });

  it("does not send to a device that is paused", async () => {
    flagged([sub("s1"), sub("s2", { pausedAt: "2026-10-02T00:00:00Z" })]);
    sendNotification.mockResolvedValue({ statusCode: 201 });
    await send();
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("soft-deletes a subscription the push service says is gone, and still succeeds for the others", async () => {
    flagged(SUBS());
    sendNotification
      .mockRejectedValueOnce(new WebPushError("gone", 410, {}, "", "https://fcm.googleapis.com/fcm/send/s1"))
      .mockResolvedValueOnce({ statusCode: 201 });
    await expect(send()).resolves.toBeUndefined();

    expect(deleted()).toEqual(["s1"]);
  });

  it("throws when every subscription turned out to be gone, so nobody reads that as delivered", async () => {
    flagged(SUBS());
    sendNotification.mockRejectedValue(new WebPushError("gone", 410, {}, "", "https://fcm.googleapis.com/fcm/send/s1"));
    await expect(send()).rejects.toThrow("expired");
    expect(deleted()).toEqual(["s1", "s2"]);
  });

  it("throws when no device could be reached for a reason that might pass", async () => {
    flagged(SUBS());
    sendNotification.mockRejectedValue(new WebPushError("unavailable", 503, {}, "try later", "https://fcm.googleapis.com/fcm/send/s1"));
    await expect(send()).rejects.toThrow("503");
    expect(deleted()).toEqual([]);
  });

  it("throws when the member has no live device", async () => {
    flagged([]);
    await expect(send()).rejects.toThrow("No live push subscriptions");
  });

  it("blocks untrusted endpoints already stored in the database without blocking a trusted device", async () => {
    flagged([sub("bad", { endpoint: "https://127.0.0.1/internal" }), sub("s1")]);
    sendNotification.mockResolvedValue({ statusCode: 201 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await send();
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0][0].endpoint).toBe("https://fcm.googleapis.com/fcm/send/s1");
    vi.restoreAllMocks();
  });

  it("reports no delivery when all stored endpoints are untrusted", async () => {
    flagged([sub("bad", { endpoint: "https://evil.example/push" })]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(webPushChannel.send("m1", { text: "Hello" }, { kind: "test", memberId: "m1" }))
      .rejects.toThrow("Untrusted push subscription endpoint");
    expect(sendNotification).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("goes out through createNotifier alongside the member's other channels", async () => {
    flagged(SUBS());
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const notifier = await createNotifier(repos, "prickle_checkin", ["m1"], { channels: ["web_push"] });
    expect(notifier.canReach("m1")).toBe(true);
    expect(await notifier.send("m1", { text: "Hello" })).toEqual(["web_push"]);
  });
});

describe("sendDiagnosticPush", () => {
  const payload = { title: "T", body: "B", url: "/admin/notifications", tag: "t" };
  const subs = () => createInMemoryRepos(new InMemoryDataset({ pushSubscriptions: [sub("abc", { p256dh: "p", auth: "a" })] }));

  it("sends the caller's payload with the caller's urgency and TTL", async () => {
    const { sendDiagnosticPush } = await import("@/lib/channels/web-push");
    sendNotification.mockResolvedValue({});
    const sent = await sendDiagnosticPush(subs(), "m1", payload, { urgency: "high", ttlSeconds: 900 });
    expect(sent).toBe(1);
    const [, body, options] = sendNotification.mock.calls[0];
    expect(JSON.parse(body)).toEqual(payload);
    expect(options).toMatchObject({ urgency: "high", TTL: 900 });
  });

  it("throws the push service's reason when nothing went out", async () => {
    const { sendDiagnosticPush } = await import("@/lib/channels/web-push");
    sendNotification.mockRejectedValue(new Error("push service down"));
    await expect(sendDiagnosticPush(subs(), "m1", payload, { urgency: "normal", ttlSeconds: 60 })).rejects.toThrow("push service down");
  });
});
