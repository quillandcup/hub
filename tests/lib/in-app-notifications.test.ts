import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "@/tests/helpers/server-page";
import { APP_URL } from "@/lib/config";

// The adapter writes with its own service-role client; point it at a fake to inspect the insert.
let serviceFake: FakeSupabase;
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => serviceFake }));
vi.mock("@/lib/slack-member-ids", () => ({ resolveSlackUserIds: async () => new Map() }));
vi.mock("@/lib/slack", () => ({ sendSlackDM: vi.fn() }));

const { membersWithFeature } = await import("@/lib/features.server");
const { hubPath, inAppRow, loadInAppNotifications, markInAppNotificationsRead, resolveInAppNotifications } = await import(
  "@/lib/channels/in-app"
);
const { createNotifier } = await import("@/lib/notifications/notify");

const callsOf = (fake: FakeSupabase, table: string) => fake.queries.filter((q) => q.table === table).flatMap((q) => q.calls);

beforeEach(() => {
  serviceFake = createFakeSupabase();
});

describe("membersWithFeature", () => {
  // m1 and m2 can sign in; m3 has no Hub account.
  const MEMBERS = {
    data: [
      { id: "m1", user_id: "u1" },
      { id: "m2", user_id: "u2" },
      { id: "m3", user_id: null },
    ],
  };

  it("is everyone with an account when the flag is on globally", async () => {
    const fake = createFakeSupabase({ feature_flags: { data: { enabled_globally: true } }, members: MEMBERS });
    expect(await membersWithFeature(fake, "in_app_notifications", ["m1", "m2", "m3"])).toEqual(new Set(["m1", "m2"]));
  });

  it("is members opted in individually or through a segment", async () => {
    const fake = createFakeSupabase({
      feature_flags: { data: null },
      members: MEMBERS,
      user_feature_previews: { data: [{ user_id: "u1" }] },
      feature_flag_segments: { data: [{ segment_id: "s1" }] },
      segment_members: { data: [{ member_id: "m2" }] },
    });
    expect(await membersWithFeature(fake, "in_app_notifications", ["m1", "m2", "m3"])).toEqual(new Set(["m1", "m2"]));
    expect(callsOf(fake, "user_feature_previews")).toContainEqual({ method: "in", args: ["user_id", ["u1", "u2"]] });
    expect(callsOf(fake, "segment_members")).toContainEqual({ method: "in", args: ["segment_id", ["s1"]] });
  });

  it("is nobody without the flag, and skips segment lookups when it has no segments", async () => {
    const fake = createFakeSupabase({ members: MEMBERS });
    expect(await membersWithFeature(fake, "in_app_notifications", ["m1", "m2"])).toEqual(new Set());
    expect(callsOf(fake, "segment_members")).toEqual([]);
  });
});

describe("hubPath", () => {
  it("keeps Hub links as paths and drops everything else", () => {
    expect(hubPath(`${APP_URL}/prickles/p1`)).toBe("/prickles/p1");
    expect(hubPath(APP_URL)).toBe("/");
    expect(hubPath("/settings/notifications")).toBe("/settings/notifications");
    expect(hubPath("https://example.com/prickles/p1")).toBeNull();
    expect(hubPath(`${APP_URL}.evil.example/x`)).toBeNull();
    expect(hubPath("//evil.example/x")).toBeNull();
    expect(hubPath(undefined)).toBeNull();
  });
});

describe("inAppRow", () => {
  it("stores the kind, what it's about, the text, a Hub path, the banner window and the expiry", () => {
    expect(
      inAppRow(
        "m1",
        {
          text: "Check in?",
          url: `${APP_URL}/prickles/p1`,
          ref: "p1",
          timeSensitiveUntil: "2026-10-05T11:00:00.000Z",
          expiresAt: "2026-10-06T11:00:00.000Z",
          slackBlocks: [{}],
        },
        { kind: "prickle_checkin" }
      )
    ).toEqual({
      member_id: "m1",
      kind: "prickle_checkin",
      ref: "p1",
      text: "Check in?",
      url: "/prickles/p1",
      banner_until: "2026-10-05T11:00:00.000Z",
      expires_at: "2026-10-06T11:00:00.000Z",
    });
  });

  it("isn't a banner when the message isn't time-sensitive", () => {
    expect(inAppRow("m1", { text: "FYI" }, { kind: "prickle_checkout" })).toMatchObject({ banner_until: null, expires_at: null });
  });
});

describe("in_app channel through createNotifier", () => {
  it("reaches flagged members by default and stores the banner", async () => {
    const fake = createFakeSupabase({
      feature_flags: { data: { enabled_globally: true } },
      members: { data: [{ id: "m1", user_id: "u1" }] },
    });
    const notifier = await createNotifier(fake, "prickle_checkin", ["m1"]);
    expect(notifier.channelsFor("m1")).toEqual(["in_app"]);

    expect(await notifier.send("m1", { text: "Check in?", url: `${APP_URL}/prickles/p1`, ref: "p1" })).toEqual(["in_app"]);
    const insert = callsOf(serviceFake, "in_app_notifications").find((c) => c.method === "insert")!;
    expect(insert.args[0]).toMatchObject({ member_id: "m1", kind: "prickle_checkin", ref: "p1", url: "/prickles/p1" });
  });

  it("can't reach members without the flag", async () => {
    const fake = createFakeSupabase({ members: { data: [{ id: "m1", user_id: "u1" }] } });
    const notifier = await createNotifier(fake, "prickle_checkin", ["m1"]);
    expect(notifier.canReach("m1")).toBe(false);
  });

  it("reports nothing delivered when the insert fails", async () => {
    serviceFake = createFakeSupabase({ in_app_notifications: { error: { message: "boom" } } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = createFakeSupabase({
      feature_flags: { data: { enabled_globally: true } },
      members: { data: [{ id: "m1", user_id: "u1" }] },
    });
    const notifier = await createNotifier(fake, "prickle_checkin", ["m1"]);
    expect(await notifier.send("m1", { text: "Check in?" })).toEqual([]);
  });
});

describe("loadInAppNotifications", () => {
  const now = new Date("2026-10-05T10:45:00Z");
  const row = (over: Record<string, unknown>) => ({
    id: "n1",
    kind: "prickle_checkin",
    text: "Check in?",
    url: "/prickles/p1",
    created_at: "2026-10-05T10:40:00Z",
    banner_until: null,
    read_at: null,
    ...over,
  });

  it("is a banner only while unread and still time-sensitive", async () => {
    const fake = createFakeSupabase({
      in_app_notifications: {
        data: [
          row({ id: "live", banner_until: "2026-10-05T11:00:00Z" }),
          row({ id: "past", banner_until: "2026-10-05T10:30:00Z" }),
          row({ id: "read", banner_until: "2026-10-05T11:00:00Z", read_at: "2026-10-05T10:41:00Z" }),
          row({ id: "plain" }),
        ],
      },
    });
    const list = await loadInAppNotifications(fake, "m1", now);
    expect(list.map((n) => [n.id, n.read, n.banner])).toEqual([
      ["live", false, true],
      ["past", false, false],
      ["read", true, false],
      ["plain", false, false],
    ]);
    expect(list[0]).toMatchObject({ kind: "prickle_checkin", text: "Check in?", url: "/prickles/p1", createdAt: "2026-10-05T10:40:00Z" });
  });

  it("reads the member's recent, unexpired ones, newest first", async () => {
    const fake = createFakeSupabase();
    await loadInAppNotifications(fake, "m1", now);
    const calls = callsOf(fake, "in_app_notifications");
    expect(calls).toContainEqual({ method: "eq", args: ["member_id", "m1"] });
    expect(calls).toContainEqual({ method: "gte", args: ["created_at", "2026-09-05T10:45:00.000Z"] });
    expect(calls).toContainEqual({ method: "or", args: [`expires_at.is.null,expires_at.gt.${now.toISOString()}`] });
    expect(calls).toContainEqual({ method: "order", args: ["created_at", { ascending: false }] });
  });
});

describe("markInAppNotificationsRead", () => {
  it("marks only the member's unread ones among those ids", async () => {
    const fake = createFakeSupabase();
    await markInAppNotificationsRead(fake, "m1", ["n1", "n2"]);
    const calls = callsOf(fake, "in_app_notifications");
    expect(calls).toContainEqual({ method: "update", args: [{ read_at: expect.any(String) }] });
    expect(calls).toContainEqual({ method: "eq", args: ["member_id", "m1"] });
    expect(calls).toContainEqual({ method: "in", args: ["id", ["n1", "n2"]] });
    expect(calls).toContainEqual({ method: "is", args: ["read_at", null] });
  });
});

describe("resolveInAppNotifications", () => {
  it("marks the member's unread ones of that kind about that ref read", async () => {
    const fake = createFakeSupabase();
    await resolveInAppNotifications(fake, "m1", "prickle_checkin", "p1");
    const calls = callsOf(fake, "in_app_notifications");
    expect(calls).toContainEqual({ method: "update", args: [{ read_at: expect.any(String) }] });
    expect(calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["member_id", "m1"],
      ["kind", "prickle_checkin"],
      ["ref", "p1"],
    ]);
    expect(calls).toContainEqual({ method: "is", args: ["read_at", null] });
  });
});
