import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/server-page";
import { APP_URL } from "@/lib/config";

const sendSlackDM = vi.fn(async (_params: { slackUserId: string; text: string; blocks?: any[] }) => {});
vi.mock("@/lib/slack", () => ({ sendSlackDM: (p: any) => sendSlackDM(p) }));

// m1 and m2 have Slack accounts; m3 doesn't.
const resolveSlackUserIds = vi.fn(
  async (_supabase: unknown, memberIds: string[]) =>
    new Map(memberIds.filter((id) => id !== "m3").map((id) => [id, `U-${id}`]))
);
vi.mock("@/lib/slack-member-ids", () => ({
  resolveSlackUserIds: (s: unknown, ids: string[]) => resolveSlackUserIds(s, ids),
}));

const { effectiveChannels, effectiveSettings, NOTIFICATION_KINDS } = await import("@/lib/notifications/registry");
const { createNotifier } = await import("@/lib/notifications/notify");
const { slackBlocks } = await import("@/lib/channels/slack");

beforeEach(() => {
  sendSlackDM.mockReset();
  resolveSlackUserIds.mockClear();
});

describe("effectiveChannels", () => {
  it("uses the kind's defaults when the member has no overrides", () => {
    expect(effectiveChannels("prickle_checkin", [])).toEqual(["slack", "in_app"]);
  });

  it("applies an override for that kind only", () => {
    const overrides = [{ kind: "prickle_checkin", channel: "slack", enabled: false }];
    expect(effectiveChannels("prickle_checkin", overrides)).toEqual(["in_app"]);
    expect(effectiveChannels("prickle_checkout", overrides)).toEqual(["slack", "in_app"]);
  });

  it("ignores overrides for channels it doesn't know", () => {
    expect(effectiveChannels("prickle_checkin", [{ kind: "prickle_checkin", channel: "carrier_pigeon", enabled: true }])).toEqual([
      "slack",
      "in_app",
    ]);
  });

  it("covers every kind in effectiveSettings", () => {
    expect(Object.keys(effectiveSettings([]))).toEqual(NOTIFICATION_KINDS.map((k) => k.id));
  });
});

describe("createNotifier", () => {
  const optedOut = { member_id: "m2", kind: "prickle_checkin", channel: "slack", enabled: false };

  it("reaches members on their channels, skipping opt-outs and members with no address", async () => {
    const fake = createFakeSupabase({ notification_preferences: { data: [optedOut] } });
    const notifier = await createNotifier(fake, "prickle_checkin", ["m1", "m2", "m3", "m1"]);

    expect(notifier.channelsFor("m1")).toEqual(["slack"]);
    expect(notifier.canReach("m2")).toBe(false);
    expect(notifier.canReach("m3")).toBe(false);
    expect(notifier.canReach("unknown")).toBe(false);
    // Only members who want Slack are resolved, once each.
    expect(resolveSlackUserIds).toHaveBeenCalledTimes(1);
    expect(resolveSlackUserIds.mock.calls[0][1]).toEqual(["m1", "m3"]);
  });

  it("sends to the member's Slack and reports the delivered channels", async () => {
    const notifier = await createNotifier(createFakeSupabase(), "prickle_checkin", ["m1"]);

    expect(await notifier.send("m1", { text: "Hello", url: `${APP_URL}/prickles/p1` })).toEqual(["slack"]);
    expect(sendSlackDM).toHaveBeenCalledWith(expect.objectContaining({ slackUserId: "U-m1", text: "Hello" }));
  });

  it("sends nothing to a member who opted out", async () => {
    const fake = createFakeSupabase({ notification_preferences: { data: [optedOut] } });
    const notifier = await createNotifier(fake, "prickle_checkin", ["m2"]);

    expect(await notifier.send("m2", { text: "Hello" })).toEqual([]);
    expect(sendSlackDM).not.toHaveBeenCalled();
  });

  it("logs a failed channel and reports nothing delivered instead of throwing", async () => {
    sendSlackDM.mockRejectedValueOnce(new Error("channel_not_found"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const notifier = await createNotifier(createFakeSupabase(), "prickle_checkin", ["m1"]);

    expect(await notifier.send("m1", { text: "Hello" })).toEqual([]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("falls back to the defaults when preferences can't be loaded", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = createFakeSupabase({ notification_preferences: { error: { message: "boom" } } });
    const notifier = await createNotifier(fake, "prickle_checkin", ["m1"]);

    expect(notifier.canReach("m1")).toBe(true);
    error.mockRestore();
  });

  it("adds a notification settings link to every message", async () => {
    const notifier = await createNotifier(createFakeSupabase(), "prickle_checkin", ["m1"]);
    await notifier.send("m1", { text: "Hello" });

    const blocks = sendSlackDM.mock.calls[0][0].blocks!;
    expect(blocks.at(-1).elements.at(-1).text).toBe(`<${APP_URL}/settings/notifications|Notification settings>`);
  });

  it("sends on forced channels regardless of preferences, without loading them", async () => {
    const fake = createFakeSupabase({ notification_preferences: { data: [optedOut] } });
    const notifier = await createNotifier(fake, "prickle_checkin", ["m2"], { channels: ["slack"] });

    expect(await notifier.send("m2", { text: "Test" })).toEqual(["slack"]);
    expect(fake.queries.some((q) => q.table === "notification_preferences")).toBe(false);
  });

  it("loads preferences in chunks for large batches", async () => {
    const fake = createFakeSupabase();
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
