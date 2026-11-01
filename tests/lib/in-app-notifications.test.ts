import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "@/tests/helpers/server-page";
import { APP_URL, SLACK_WORKSPACE_URL } from "@/lib/config";
import { InMemoryDataset } from "@/lib/data/in-memory";
import type { InAppNotificationRow } from "@/lib/data/notifications";
import { createInMemoryRepos } from "@/lib/data/repos";

// The adapter writes with its own service-role client; point it at a fake to inspect the insert.
let serviceFake: FakeSupabase;
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => serviceFake }));
vi.mock("@/lib/slack-member-ids", () => ({ resolveSlackUserIds: async () => new Map() }));
vi.mock("@/lib/slack", () => ({ sendSlackDM: vi.fn() }));

const {
  countInAppNotifications,
  hubPath,
  notificationUrl,
  inAppRow,
  loadInAppNotifications,
  loadInboxPage,
  markAllInAppNotificationsRead,
  markInAppNotificationsRead,
  markInAppNotificationsUnread,
  resolveInAppNotifications,
} = await import("@/lib/channels/in-app");
const { createNotifier } = await import("@/lib/notifications/notify");


const callsOf = (fake: FakeSupabase, table: string) => fake.queries.filter((q) => q.table === table).flatMap((q) => q.calls);

beforeEach(() => {
  serviceFake = createFakeSupabase();
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

describe("notificationUrl", () => {
  it("keeps Hub paths and Slack workspace links, and drops any other site", () => {
    expect(notificationUrl(`${APP_URL}/prickles/p1`)).toBe("/prickles/p1");
    expect(notificationUrl(`${SLACK_WORKSPACE_URL}/app_redirect?channel=C1`)).toBe(`${SLACK_WORKSPACE_URL}/app_redirect?channel=C1`);
    expect(notificationUrl(`${SLACK_WORKSPACE_URL}.evil.example/x`)).toBeNull();
    expect(notificationUrl("https://example.com/x")).toBeNull();
    expect(notificationUrl(undefined)).toBeNull();
  });
});

describe("inAppRow", () => {
  it("stores the kind, what it's about, the text, a Hub path and how long it's a banner", () => {
    expect(
      inAppRow(
        "m1",
        {
          text: "Check in?",
          url: `${APP_URL}/prickles/p1`,
          ref: "p1",
          timeSensitiveUntil: "2026-10-05T11:00:00.000Z",
          slackBlocks: [{}],
        },
        { kind: "prickle_checkin", memberId: "m1" }
      )
    ).toEqual({
      memberId: "m1",
      kind: "prickle_checkin",
      ref: "p1",
      text: "Check in?",
      url: "/prickles/p1",
      bannerUntil: "2026-10-05T11:00:00.000Z",
    });
  });

  it("isn't a banner when the message isn't time-sensitive", () => {
    expect(inAppRow("m1", { text: "FYI" }, { kind: "prickle_checkout", memberId: "m1" })).toMatchObject({ bannerUntil: null });
  });
});

describe("in_app channel through createNotifier", () => {
  it("reaches members and stores the banner", async () => {
    const fake = createFakeSupabase({
      members: { data: [{ id: "m1", user_id: "u1" }] },
    });
    const notifier = await createNotifier(fake, "prickle_checkin", ["m1"]);
    expect(notifier.channelsFor("m1")).toEqual(["in_app"]);

    expect(await notifier.send("m1", { text: "Check in?", url: `${APP_URL}/prickles/p1`, ref: "p1" })).toEqual(["in_app"]);
    const insert = callsOf(serviceFake, "in_app_notifications").find((c) => c.method === "insert")!;
    expect(insert.args[0]).toMatchObject({ member_id: "m1", kind: "prickle_checkin", ref: "p1", url: "/prickles/p1" });
  });

  it("reports nothing delivered when the insert fails", async () => {
    serviceFake = createFakeSupabase({ in_app_notifications: { error: { message: "boom" } } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = createFakeSupabase({
      members: { data: [{ id: "m1", user_id: "u1" }] },
    });
    const notifier = await createNotifier(fake, "prickle_checkin", ["m1"]);
    expect(await notifier.send("m1", { text: "Check in?" })).toEqual([]);
  });
});

const ME = "mbr_AAAAAAAAAAA1";
const OTHER = "mbr_AAAAAAAAAAA2";
const row = (id: string, over: Partial<InAppNotificationRow> = {}): InAppNotificationRow => ({
  id,
  memberId: ME,
  kind: "prickle_checkin",
  ref: null,
  text: "Check in?",
  url: "/prickles/p1",
  bannerUntil: null,
  readAt: null,
  createdAt: "2026-10-05T10:40:00Z",
  ...over,
});
const reposWith = (rows: InAppNotificationRow[]) => createInMemoryRepos(new InMemoryDataset({ inAppNotifications: rows }));

describe("loadInAppNotifications", () => {
  const now = new Date("2026-10-05T10:45:00Z");

  it("is a banner only while unread and still time-sensitive", async () => {
    const repos = reposWith([
      row("live", { bannerUntil: "2026-10-05T11:00:00Z", createdAt: "2026-10-05T10:44:00Z" }),
      row("past", { bannerUntil: "2026-10-05T10:30:00Z", createdAt: "2026-10-05T10:43:00Z" }),
      row("read", { bannerUntil: "2026-10-05T11:00:00Z", readAt: "2026-10-05T10:41:00Z", createdAt: "2026-10-05T10:42:00Z" }),
      row("plain", { createdAt: "2026-10-05T10:41:00Z" }),
    ]);
    const list = await loadInAppNotifications(repos, ME, now, { limit: 10 });
    expect(list.map((n) => [n.id, n.read, n.banner])).toEqual([
      ["live", false, true],
      ["past", false, false],
      ["read", true, false],
      ["plain", false, false],
    ]);
    expect(list[0]).toMatchObject({ kind: "prickle_checkin", text: "Check in?", url: "/prickles/p1", createdAt: "2026-10-05T10:44:00Z" });
  });

  it("reads the member's latest, newest first, however old, and nobody else's", async () => {
    const repos = reposWith([
      row("ancient", { createdAt: "2020-01-01T00:00:00Z" }),
      row("new", { createdAt: "2026-10-05T10:40:00Z" }),
      row("middle", { createdAt: "2026-09-01T00:00:00Z" }),
      row("theirs", { memberId: OTHER, createdAt: "2026-10-05T10:44:00Z" }),
    ]);
    expect((await loadInAppNotifications(repos, ME, now, { limit: 10 })).map((n) => n.id)).toEqual(["new", "middle", "ancient"]);
    expect((await loadInAppNotifications(repos, ME, now, { limit: 2 })).map((n) => n.id)).toEqual(["new", "middle"]);
  });

  it("is empty, and logs, when the read fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const repos = reposWith([row("n1")]);
    repos.notifications.inAppLatest = async () => {
      throw new Error("boom");
    };
    expect(await loadInAppNotifications(repos, ME, now, { limit: 10 })).toEqual([]);
    expect(log).toHaveBeenCalled();
  });
});

describe("countInAppNotifications", () => {
  it("counts all of the member's, or just the unread", async () => {
    const repos = reposWith([row("a"), row("b"), row("c", { readAt: "2026-10-05T10:41:00Z" }), row("d", { readAt: "2026-10-05T10:41:00Z" }), row("theirs", { memberId: OTHER })]);
    expect(await countInAppNotifications(repos, ME)).toBe(4);
    expect(await countInAppNotifications(repos, ME, { unreadOnly: true })).toBe(2);
  });

  it("counts zero, and logs, when the read fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const repos = reposWith([row("a")]);
    repos.notifications.inAppCount = async () => {
      throw new Error("boom");
    };
    expect(await countInAppNotifications(repos, ME)).toBe(0);
    expect(log).toHaveBeenCalled();
  });
});

describe("loadInboxPage", () => {
  const now = new Date("2026-10-05T10:45:00Z");
  const newestFirst = { column: "created_at" as const, direction: "desc" as const };
  /** n notifications, id "n001".. oldest to newest, so the newest has the highest number. */
  const many = (n: number, over: (i: number) => Partial<InAppNotificationRow> = () => ({})) =>
    Array.from({ length: n }, (_, i) =>
      row(`n${String(i + 1).padStart(3, "0")}`, { createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), ...over(i + 1) })
    );

  it("counts per tab, then serves the page asked for", async () => {
    const repos = reposWith(many(120));
    const page = await loadInboxPage(repos, ME, now, { filter: "all", kind: null, sort: newestFirst, page: 2, pageSize: 50 });
    expect(page).toMatchObject({ total: 120, counts: { all: 120, unread: 120 }, page: 2, pageSize: 50 });
    // Newest first: page 2 is the 51st to 100th newest, i.e. n070 down to n021.
    expect(page.items).toHaveLength(50);
    expect(page.items[0].id).toBe("n070");
    expect(page.items[49].id).toBe("n021");
  });

  it("clamps a page past the end to the last one", async () => {
    const repos = reposWith(many(30));
    const page = await loadInboxPage(repos, ME, now, { filter: "all", kind: null, sort: newestFirst, page: 9, pageSize: 25 });
    expect(page.page).toBe(2);
    expect(page.items.map((n) => n.id)).toEqual(["n005", "n004", "n003", "n002", "n001"]);
  });

  it("filters unread and by kind everywhere, and breaks sort ties newest first", async () => {
    const repos = reposWith([
      row("a", { kind: "prickle_checkout", createdAt: "2026-10-01T00:00:00Z" }),
      row("b", { kind: "prickle_checkout", createdAt: "2026-10-02T00:00:00Z" }),
      row("c", { kind: "prickle_checkout", createdAt: "2026-10-03T00:00:00Z", readAt: "2026-10-04T00:00:00Z" }),
      row("d", { kind: "prickle_checkin", createdAt: "2026-10-04T00:00:00Z" }),
      row("theirs", { kind: "prickle_checkout", memberId: OTHER }),
    ]);
    const page = await loadInboxPage(repos, ME, now, { filter: "unread", kind: "prickle_checkout", sort: { column: "kind", direction: "asc" }, page: 1, pageSize: 50 });
    // Counts follow the kind chosen: three checkouts, two of them unread.
    expect(page.counts).toEqual({ all: 3, unread: 2 });
    expect(page.items.map((n) => n.id)).toEqual(["b", "a"]);
  });

  it("serves an empty page, and logs, when the rows can't be read", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const repos = reposWith(many(3));
    repos.notifications.inAppPage = async () => {
      throw new Error("boom");
    };
    const page = await loadInboxPage(repos, ME, now, { filter: "all", kind: null, sort: newestFirst, page: 1, pageSize: 50 });
    expect(page).toMatchObject({ items: [], total: 3 });
    expect(log).toHaveBeenCalled();
  });
});

describe("marking read", () => {
  const statuses = async (repos: ReturnType<typeof reposWith>) =>
    Object.fromEntries((await loadInAppNotifications(repos, ME, new Date("2026-10-06T00:00:00Z"), { limit: 20 })).map((n) => [n.id, n.read]));

  it("marks every unread one of the member's, and only theirs", async () => {
    const repos = reposWith([row("n1"), row("n2"), row("theirs", { memberId: OTHER })]);
    expect(await markAllInAppNotificationsRead(repos, ME)).toEqual({ error: null });
    expect(await statuses(repos)).toEqual({ n1: true, n2: true });
    expect((await repos.notifications.inAppCount(OTHER, { unreadOnly: true }))).toBe(1);
  });

  it("marks only the member's unread ones among those ids", async () => {
    const repos = reposWith([row("n1"), row("n2"), row("n3"), row("theirs", { memberId: OTHER })]);
    await markInAppNotificationsRead(repos, ME, ["n1", "n2", "theirs"]);
    expect(await statuses(repos)).toEqual({ n1: true, n2: true, n3: false });
    expect(await repos.notifications.inAppCount(OTHER, { unreadOnly: true })).toBe(1);
  });

  it("marks them unread again", async () => {
    const repos = reposWith([row("n1", { readAt: "2026-10-05T10:41:00Z" })]);
    await markInAppNotificationsUnread(repos, ME, ["n1"]);
    expect(await statuses(repos)).toEqual({ n1: false });
  });

  it("reports a failed write the way the server actions read it", async () => {
    const repos = reposWith([row("n1")]);
    repos.notifications.markAllInAppRead = async () => {
      throw new Error("boom");
    };
    expect(await markAllInAppNotificationsRead(repos, ME)).toEqual({ error: expect.objectContaining({ message: "boom" }) });
  });
});

describe("resolveInAppNotifications", () => {
  it("marks the member's unread ones of that kind about that ref read", async () => {
    const repos = reposWith([
      row("match", { ref: "p1" }),
      row("other-ref", { ref: "p2" }),
      row("other-kind", { ref: "p1", kind: "prickle_checkout" }),
      row("theirs", { ref: "p1", memberId: OTHER }),
    ]);
    await resolveInAppNotifications(repos, ME, "prickle_checkin", "p1");
    const read = Object.fromEntries((await loadInAppNotifications(repos, ME, new Date("2026-10-06T00:00:00Z"), { limit: 20 })).map((n) => [n.id, n.read]));
    expect(read).toEqual({ match: true, "other-ref": false, "other-kind": false });
    expect(await repos.notifications.inAppCount(OTHER, { unreadOnly: true })).toBe(1);
  });
});
