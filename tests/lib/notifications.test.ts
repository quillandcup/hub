import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase, type FakeTables } from "@/tests/helpers/server-page";
import { APP_URL } from "@/lib/config";

const sendSlackDM = vi.fn(async (_params: { slackUserId: string; text: string; blocks?: any[] }) => {});
vi.mock("@/lib/slack", () => ({ sendSlackDM: (p: any) => sendSlackDM(p) }));
const captureException = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureException }));
const sendOperationsAlert = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/operations-alerts", () => ({ sendOperationsAlert }));

// m1 and m2 have Slack accounts; m3 doesn't.
const resolveSlackUserIds = vi.fn(
  async (_supabase: unknown, memberIds: string[]) =>
    new Map(memberIds.filter((id) => id !== "m3").map((id) => [id, `U-${id}`]))
);
vi.mock("@/lib/slack-member-ids", () => ({
  resolveSlackUserIds: (s: unknown, ids: string[]) => resolveSlackUserIds(s, ids),
}));

// Mock service role client for in-app notifications
let serviceFake: any;
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => serviceFake }));

const { effectiveChannels, effectiveSettings, NOTIFICATION_KINDS } = await import("@/lib/notifications/registry");
const { createNotifier } = await import("@/lib/notifications/notify");
const { slackBlocks } = await import("@/lib/channels/slack");
const slackReady = (tables: FakeTables = {}) => createFakeSupabase(tables);

beforeEach(() => {
  sendSlackDM.mockReset();
  resolveSlackUserIds.mockClear();
  captureException.mockClear();
  sendOperationsAlert.mockClear();
  serviceFake = createFakeSupabase();
});

describe("effectiveChannels", () => {
  it("uses the kind's defaults when the member has no overrides", () => {
    expect(effectiveChannels("prickle_checkin", [])).toEqual(["slack", "in_app", "web_push"]);
  });

  it("applies an override for that kind only", () => {
    const overrides = [{ kind: "prickle_checkin", channel: "slack", enabled: false }];
    expect(effectiveChannels("prickle_checkin", overrides)).toEqual(["in_app", "web_push"]);
    expect(effectiveChannels("prickle_checkout", overrides)).toEqual(["slack", "in_app", "web_push"]);
  });

  it("ignores overrides for channels it doesn't know", () => {
    expect(effectiveChannels("prickle_checkin", [{ kind: "prickle_checkin", channel: "carrier_pigeon", enabled: true }])).toEqual([
      "slack",
      "in_app",
      "web_push",
    ]);
  });

  it("covers every kind in effectiveSettings", () => {
    expect(Object.keys(effectiveSettings([]))).toEqual(NOTIFICATION_KINDS.map((k) => k.id));
  });
});

describe("createNotifier", () => {
  const optedOut = { member_id: "m2", kind: "prickle_checkin", channel: "slack", enabled: false };

  it("offers Slack to matched members without requiring a Hub account", async () => {
    const fake = createFakeSupabase();
    const notifier = await createNotifier(fake, "prickle_checkin", ["m1", "m2"]);

    expect(notifier.channelsFor("m1")).toEqual(["slack", "in_app"]);
    expect(notifier.channelsFor("m2")).toEqual(["slack", "in_app"]);
    expect(resolveSlackUserIds.mock.calls[0][1]).toEqual(["m1", "m2"]);
  });

  it("reaches members on their channels, skipping opt-outs and members with no address", async () => {
    const fake = slackReady({ notification_preferences: { data: [optedOut] } });
    const notifier = await createNotifier(fake, "prickle_checkin", ["m1", "m2", "m3", "m1"]);

    expect(notifier.channelsFor("m1")).toEqual(["slack", "in_app"]);
    expect(notifier.canReach("m2")).toBe(true);
    expect(notifier.canReach("m3")).toBe(true);
    expect(notifier.canReach("unknown")).toBe(false);
    // Only members who want Slack are resolved, once each.
    expect(resolveSlackUserIds).toHaveBeenCalledTimes(1);
    expect(resolveSlackUserIds.mock.calls[0][1]).toEqual(["m1", "m3"]);
  });

  it("sends to the member's Slack and reports the delivered channels", async () => {
    const notifier = await createNotifier(slackReady(), "prickle_checkin", ["m1"]);

    expect(await notifier.send("m1", { text: "Hello", url: `${APP_URL}/prickles/p1` })).toEqual(["slack", "in_app"]);
    expect(sendSlackDM).toHaveBeenCalledWith(expect.objectContaining({ slackUserId: "U-m1", text: "Hello" }));
  });

  it("still sends in-app to a member who opted out of Slack only", async () => {
    const fake = slackReady({ notification_preferences: { data: [optedOut] } });
    const notifier = await createNotifier(fake, "prickle_checkin", ["m2"]);

    expect(await notifier.send("m2", { text: "Hello" })).toEqual(["in_app"]);
    expect(sendSlackDM).not.toHaveBeenCalled();
  });

  it("logs a failed channel and still sends on other channels", async () => {
    sendSlackDM.mockRejectedValueOnce(new Error("channel_not_found"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const notifier = await createNotifier(slackReady(), "prickle_checkin", ["m1"]);

    expect(await notifier.send("m1", { text: "Hello" })).toEqual(["in_app"]);
    expect(error).toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ tags: { notification_kind: "prickle_checkin", notification_channel: "slack" } }));
    expect(sendOperationsAlert).toHaveBeenCalledWith(expect.anything(), { type: "slack_dm_failed", notificationKind: "prickle_checkin", memberId: "m1" });
    error.mockRestore();
  });

  it("aborts before resolving addresses or sending when preferences can't be loaded", async () => {
    const fake = createFakeSupabase({ notification_preferences: { error: { message: "boom" } } });
    await expect(createNotifier(fake, "prickle_checkin", ["m1"])).rejects.toThrow("preferences failed: boom");
    expect(resolveSlackUserIds).not.toHaveBeenCalled();
    expect(sendSlackDM).not.toHaveBeenCalled();
  });

  it("doesn't use partial preferences when a later batch fails", async () => {
    let batch = 0;
    const fake = createFakeSupabase({ notification_preferences: () =>
      ++batch === 1 ? { data: [] } : { error: { message: "unavailable" } },
    });
    await expect(createNotifier(fake, "prickle_checkin", Array.from({ length: 201 }, (_, i) => `m${i}`)))
      .rejects.toThrow("preferences failed: unavailable");
    expect(resolveSlackUserIds).not.toHaveBeenCalled();
    expect(sendSlackDM).not.toHaveBeenCalled();
  });

  it("adds a notification settings link to every message", async () => {
    const notifier = await createNotifier(slackReady(), "prickle_checkin", ["m1"]);
    await notifier.send("m1", { text: "Hello" });

    const blocks = sendSlackDM.mock.calls[0][0].blocks!;
    expect(blocks.at(-1).elements.at(-1).text).toBe(`<${APP_URL}/settings/notifications|Notification settings>`);
  });

  it("sends on forced channels regardless of preferences, without loading them", async () => {
    const fake = createFakeSupabase({ notification_preferences: { data: [optedOut] } });
    const notifier = await createNotifier(fake, "prickle_checkin", ["m2"], { channels: ["slack"] });

    expect(await notifier.send("m2", { text: "Test" })).toEqual(["slack"]);
    expect(fake.queries.some((q) => q.table === "notification_preferences")).toBe(false);
    expect(fake.queries.some((q) => q.table === "feature_flags")).toBe(false);
  });

  it("loads preferences in chunks for large batches", async () => {
    const fake = slackReady();
    const ids = Array.from({ length: 450 }, (_, i) => `x${i}`);
    await createNotifier(fake, "prickle_checkin", ids);

    expect(fake.queries.filter((q) => q.table === "notification_preferences")).toHaveLength(3);
  });
});

describe("slackBlocks (shared Slack channel)", () => {
  const link = { label: "Settings", url: `${APP_URL}/s` };

  it("renders text and the Hub link when there are no blocks, and no footer without footer links", () => {
    const blocks = slackBlocks({ text: "Hi", url: `${APP_URL}/x` });
    expect(blocks).toEqual([{ type: "section", text: { type: "mrkdwn", text: `Hi\n<${APP_URL}/x|Open in the Hub>` } }]);
  });

  it("labels the link with linkLabel when the url isn't the Hub", () => {
    const blocks = slackBlocks({ text: "Hi", url: "https://x.example/y", linkLabel: "Open #start-here in Slack" });
    expect(blocks[0].text.text).toBe("Hi\n<https://x.example/y|Open #start-here in Slack>");
  });

  it("renders footer links as a context block", () => {
    const blocks = slackBlocks({ text: "Hi", footerLinks: [link] });
    expect(blocks[1]).toEqual({ type: "context", elements: [{ type: "mrkdwn", text: `<${APP_URL}/s|Settings>` }] });
  });

  it("adds footer links to a trailing context footer instead of a second footer", () => {
    const footer = { type: "context", elements: [{ type: "mrkdwn", text: "Optional." }] };
    const blocks = slackBlocks({ text: "Hi", slackBlocks: [{ type: "section" }, footer], footerLinks: [link] });
    expect(blocks).toHaveLength(2);
    expect(blocks[1].elements.map((e: any) => e.text)).toEqual(["Optional.", `<${APP_URL}/s|Settings>`]);
  });
});

describe("createNotifier: usage analytics", () => {
  const members = { members: { data: [{ id: "m1", user_id: "u-1" }, { id: "m2", user_id: "u-2" }] } };
  const inserted = (fake: ReturnType<typeof createFakeSupabase>, table: string) =>
    fake.queries.filter((q) => q.table === table).flatMap((q) => q.calls.filter((c) => c.method === "insert").map((c) => c.args[0]));

  it("tags the Hub links in what goes out on Slack with the kind and channel", async () => {
    const notifier = await createNotifier(slackReady(), "prickle_checkin", ["m1"]);
    await notifier.send("m1", { text: "Hello", url: `${APP_URL}/prickles/p1` });

    const first = sendSlackDM.mock.calls[0][0].blocks![0].text.text as string;
    expect(first).toContain(`${APP_URL}/prickles/p1?nk=prickle_checkin&nc=slack`);
    // The settings link in the footer isn't tagged: opening settings isn't opening the notification.
    expect(sendSlackDM.mock.calls[0][0].blocks!.at(-1).elements.at(-1).text).toBe(`<${APP_URL}/settings/notifications|Notification settings>`);
  });

  it("tags links a feature put in its own Slack blocks", async () => {
    const notifier = await createNotifier(slackReady(), "prickle_checkin", ["m1"]);
    await notifier.send("m1", {
      text: "Hello",
      slackBlocks: [{ type: "actions", elements: [{ type: "button", url: `${APP_URL}/streaks` }] }],
    });
    expect(sendSlackDM.mock.calls[0][0].blocks![0].elements[0].url).toBe(`${APP_URL}/streaks?nk=prickle_checkin&nc=slack`);
  });

  it("does not tag in-app notifications: the click is recorded in the Hub", async () => {
    const notifier = await createNotifier(slackReady(), "prickle_checkin", ["m1"]);
    await notifier.send("m1", { text: "Hello", url: `${APP_URL}/prickles/p1` });
    const rows = inserted(serviceFake, "in_app_notifications").flat();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(JSON.stringify(row)).not.toContain("nk=");
  });

  it("records a notification_sent for each channel it reached, against the member's user", async () => {
    const fake = slackReady(members);
    const notifier = await createNotifier(fake, "prickle_checkin", ["m1"]);
    await notifier.send("m1", { text: "Hello" });

    const [rows] = inserted(fake, "analytics_events");
    expect(rows).toHaveLength(2);
    expect(rows).toEqual([
      expect.objectContaining({ user_id: "u-1", source: "system", session_id: null, event: "notification_sent", properties: { kind: "prickle_checkin", channel: "slack" } }),
      expect.objectContaining({ user_id: "u-1", event: "notification_sent", properties: { kind: "prickle_checkin", channel: "in_app" } }),
    ]);
  });

  it("records only the channels that delivered", async () => {
    sendSlackDM.mockRejectedValueOnce(new Error("channel_not_found"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = slackReady(members);
    const notifier = await createNotifier(fake, "prickle_checkin", ["m1"]);
    await notifier.send("m1", { text: "Hello" });
    expect((inserted(fake, "analytics_events")[0] as any[]).map((r) => r.properties.channel)).toEqual(["in_app"]);
    vi.restoreAllMocks();
  });

  it("records nothing for a send the member asked for (forced channels), and doesn't even look up users", async () => {
    const fake = slackReady(members);
    const notifier = await createNotifier(fake, "prickle_checkin", ["m1"], { channels: ["slack"] });
    await notifier.send("m1", { text: "Test" });
    expect(inserted(fake, "analytics_events")).toEqual([]);
    expect(fake.queries.some((q) => q.table === "members")).toBe(false);
  });

  it("records nothing for a member with no Hub account", async () => {
    const fake = slackReady({ members: { data: [{ id: "m1", user_id: null }] } });
    const notifier = await createNotifier(fake, "prickle_checkin", ["m1"]);
    await notifier.send("m1", { text: "Hello" });
    expect(inserted(fake, "analytics_events")).toEqual([]);
  });

  it("still sends when the usage log can't be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = slackReady({ members: { error: { message: "down" } }, analytics_events: { error: { message: "down" } } });
    const notifier = await createNotifier(fake, "prickle_checkin", ["m1"]);
    expect(await notifier.send("m1", { text: "Hello" })).toEqual(["slack", "in_app"]);
    vi.restoreAllMocks();
  });
});
