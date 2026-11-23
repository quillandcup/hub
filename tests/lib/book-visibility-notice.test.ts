import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { APP_URL } from "@/lib/config";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import { isNotificationKind, notificationKind } from "@/lib/notifications/registry";
import { renderNotificationEmail } from "@/emails/notifications";

// The one-time heads-up that books are on the public Hedgie Bookshelf, end to end on the in-memory repositories with Slack faked:
// who is told, once, on the channels they chose, and that a dry run sends and records nothing at all.
const sendSlackDM = vi.fn(async (_params: { slackUserId: string; text: string; blocks?: any[] }) => {});
vi.mock("@/lib/slack", async () => ({
  ...(await vi.importActual<typeof import("@/lib/slack")>("@/lib/slack")),
  sendSlackDM: (p: any) => sendSlackDM(p),
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
const requireApiPermission = vi.fn();
vi.mock("@/lib/supabase/api-auth", () => ({ requireApiPermission: (r: unknown) => requireApiPermission(r) }));
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/lib/slack-matching", () => ({
  matchSlackUsersToMembers: (_slack: unknown, members: { id: string }[]) => new Map(members.map((m) => [`U-${m.id}`, m.id])),
}));

const { BOOK_VISIBILITY_NOTICE_KEY, BOOK_VISIBILITY_NOTICE_KIND, BOOKS_CONTROL_PATH, bookVisibilityNoticeMessage, sendBookVisibilityNotices } = await import("@/lib/book-visibility-notice");
const { GET } = await import("@/app/api/internal/book-visibility-notice/route");

const NOW = new Date("2026-11-30T14:00:00Z");
let dataset: InMemoryDataset;
let repos: Repos;

const member = (id: string, over: Record<string, unknown> = {}) => ({ id, name: `Member ${id}`, firstJoinedAt: "2024-01-01", userId: null, ...over });
const book = (id: string, memberId: string, over: Record<string, unknown> = {}) => ({ id, member_id: memberId, title: `Fake ${id}`, published_date: "2026-01-01", cover_asset_id: null, ...over });

function setup(seed: ConstructorParameters<typeof InMemoryDataset>[0] = {}) {
  dataset = new InMemoryDataset({
    members: [member("m1"), member("m2"), member("m3"), member("m4")],
    memberBooks: [book("b1", "m1"), book("b2", "m2"), book("b3", "m2"), book("b4", "m3", { visibility: "private" }), book("b5", "m4", { deleted_at: "2026-02-01T00:00:00Z" })],
    ...seed,
  });
  repos = createInMemoryRepos(dataset);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  sendSlackDM.mockClear();
  setup();
});

describe("the message", () => {
  it("says it plainly, for one book and for several, with one link to where each book's control is", () => {
    const one = bookVisibilityNoticeMessage(1);
    expect(one.text).toBe("Your published book is on the Hedgie Bookshelf, which anyone can see. You can hide it or limit it to members in My Writing any time.");
    expect(one.url).toBe(`${APP_URL}${BOOKS_CONTROL_PATH}`);
    expect(BOOKS_CONTROL_PATH).toBe("/projects/books");
    const many = bookVisibilityNoticeMessage(3);
    expect(many.text).toBe("Your published books are on the Hedgie Bookshelf, which anyone can see. You can hide them or limit them to members in My Writing any time.");
    expect(many.url).toBe(one.url);
    expect(JSON.stringify(one.slackBlocks)).toContain(`<${APP_URL}/projects/books|Choose who sees your book>`);
  });

  it("names no book and no member, so nothing a person wrote is in it", () => {
    for (const n of [1, 2]) {
      const message = bookVisibilityNoticeMessage(n);
      expect(JSON.stringify(message)).not.toMatch(/Fake|Member|m1|b1/);
    }
  });

  it("renders as an email with its button into My Books, and as a registered kind a member can choose channels for", async () => {
    expect(isNotificationKind("book_visibility_notice")).toBe(true);
    expect(notificationKind("book_visibility_notice").defaultChannels).toEqual(["slack", "in_app"]);
    const message = bookVisibilityNoticeMessage(1);
    const email = await renderNotificationEmail("book_visibility_notice", { text: message.text, title: message.title, url: message.url });
    expect(email.subject).toBe("Your book is on the Hedgie Bookshelf");
    expect(email.html).toContain("Choose who sees your books");
    expect(email.html).toContain(`${APP_URL}/projects/books`);
    expect(email.text).toContain("anyone can see");
  });
});

describe("sendBookVisibilityNotices", () => {
  const live = async (ids: string[]) => new Set(ids);

  it("tells each active member who has a book at the globe, once, as one message, and claims it", async () => {
    expect(await sendBookVisibilityNotices(repos, NOW, { liveFor: live })).toEqual({ sent: 2, dryRun: 0 });
    // m1 has one book, m2 two; m3's only book is private and m4's is deleted: neither is told.
    expect(sendSlackDM.mock.calls.map((c) => [c[0].slackUserId, c[0].text]).sort()).toEqual([
      ["U-m1", bookVisibilityNoticeMessage(1).text],
      ["U-m2", bookVisibilityNoticeMessage(2).text],
    ]);
    expect(dataset.notificationLog.map((r) => [r.recipient, r.kind, r.dedupKey]).sort()).toEqual([
      ["m1", BOOK_VISIBILITY_NOTICE_KIND, BOOK_VISIBILITY_NOTICE_KEY],
      ["m2", BOOK_VISIBILITY_NOTICE_KIND, BOOK_VISIBILITY_NOTICE_KEY],
    ]);
  });

  it("tells nobody twice: a second run, and a book added later, send nothing", async () => {
    await sendBookVisibilityNotices(repos, NOW, { liveFor: live });
    sendSlackDM.mockClear();
    dataset.memberBooks.push(book("b6", "m1"));
    expect(await sendBookVisibilityNotices(repos, NOW, { liveFor: live })).toEqual({ sent: 0, dryRun: 0 });
    expect(sendSlackDM).not.toHaveBeenCalled();
  });

  it("does not tell a member who has since made every book private, and does when a book is shown again", async () => {
    dataset.memberBooks.find((b) => b.id === "b1")!.visibility = "private";
    expect(await sendBookVisibilityNotices(repos, NOW, { liveFor: live })).toEqual({ sent: 1, dryRun: 0 });
    expect(sendSlackDM.mock.calls.map((c) => c[0].slackUserId)).toEqual(["U-m2"]);
    dataset.memberBooks.find((b) => b.id === "b1")!.visibility = "public";
    expect(await sendBookVisibilityNotices(repos, NOW, { liveFor: live })).toEqual({ sent: 1, dryRun: 0 });
  });

  it("does not tell a member who is no longer active", async () => {
    setup({ members: [member("m1", { status: "former" }), member("m2")] });
    await sendBookVisibilityNotices(repos, NOW, { liveFor: live });
    expect(sendSlackDM.mock.calls.map((c) => c[0].slackUserId)).toEqual(["U-m2"]);
  });

  it("skips a member who opted out everywhere without claiming, so turning a channel on later still tells them", async () => {
    setup({
      members: [member("m1")],
      memberBooks: [book("b1", "m1")],
      notificationPreferences: [
        { memberId: "m1", kind: "book_visibility_notice", channel: "slack", enabled: false },
        { memberId: "m1", kind: "book_visibility_notice", channel: "in_app", enabled: false },
      ],
    });
    expect(await sendBookVisibilityNotices(repos, NOW, { liveFor: live })).toEqual({ sent: 0, dryRun: 0 });
    expect(dataset.notificationLog).toEqual([]);
  });

  it("gives the claim back when the message reached no channel, so the next run tries again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sendSlackDM.mockRejectedValueOnce(new Error("slack down"));
    setup({ members: [member("m1")], memberBooks: [book("b1", "m1")], notificationPreferences: [{ memberId: "m1", kind: "book_visibility_notice", channel: "in_app", enabled: false }] });
    expect(await sendBookVisibilityNotices(repos, NOW, { liveFor: live })).toEqual({ sent: 0, dryRun: 0 });
    expect(dataset.notificationLog).toEqual([]);
    expect(await sendBookVisibilityNotices(repos, NOW, { liveFor: live })).toEqual({ sent: 1, dryRun: 0 });
  });

  it("sends nothing and does nothing when no member has a book at the globe", async () => {
    setup({ memberBooks: [] });
    expect(await sendBookVisibilityNotices(repos, NOW, { liveFor: live })).toEqual({ sent: 0, dryRun: 0 });
    expect(sendSlackDM).not.toHaveBeenCalled();
  });

  describe("in dry run", () => {
    it("is the default: nobody is live unless the flag says so, so a missing switch can never send", async () => {
      expect(await sendBookVisibilityNotices(repos, NOW)).toEqual({ sent: 0, dryRun: 2 });
      expect(sendSlackDM).not.toHaveBeenCalled();
      expect(dataset.notificationLog).toEqual([]);
    });

    it("logs who it would tell, on which channels, with the message, and sends and records nothing", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      expect(await sendBookVisibilityNotices(repos, NOW, { liveFor: async () => new Set() })).toEqual({ sent: 0, dryRun: 2 });
      expect(sendSlackDM).not.toHaveBeenCalled();
      expect(dataset.notificationLog).toEqual([]);
      expect(dataset.inAppNotifications).toEqual([]);
      const lines = log.mock.calls.filter((c) => String(c[0]).includes("DRY RUN")).map((c) => JSON.parse(String(c[1])));
      expect(lines.map((l) => l.memberId).sort()).toEqual(["m1", "m2"]);
      expect(lines[0]).toMatchObject({ wouldSend: true, channels: expect.arrayContaining(["slack", "in_app"]), url: `${APP_URL}/projects/books` });
      expect(lines.find((l) => l.memberId === "m2")).toMatchObject({ books: 2, text: bookVisibilityNoticeMessage(2).text });
    });

    it("starts from a clean slate: going live after a dry run sends to everyone, once", async () => {
      await sendBookVisibilityNotices(repos, NOW);
      expect(await sendBookVisibilityNotices(repos, NOW, { liveFor: live })).toEqual({ sent: 2, dryRun: 0 });
      expect(await sendBookVisibilityNotices(repos, NOW, { liveFor: live })).toEqual({ sent: 0, dryRun: 0 });
    });

    it("is live only for the members the flag covers, and logs the rest", async () => {
      expect(await sendBookVisibilityNotices(repos, NOW, { liveFor: live.bind(null, ["m2"]) })).toEqual({ sent: 1, dryRun: 1 });
      expect(sendSlackDM.mock.calls.map((c) => c[0].slackUserId)).toEqual(["U-m2"]);
      expect(dataset.notificationLog.map((r) => r.recipient)).toEqual(["m2"]);
    });
  });
});

describe("GET /api/internal/book-visibility-notice", () => {
  const request = () => new NextRequest("http://localhost/api/internal/book-visibility-notice");
  const flag = (enabled: boolean) => ({ feature_key: "book_visibility_notice", enabled_globally: enabled, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z" });

  beforeEach(() => {
    requireApiPermission.mockResolvedValue({ user: { id: "admin" }, forbidden: false });
  });

  it("refuses a visitor who is signed out, and one who is not allowed to run internal jobs", async () => {
    requireApiPermission.mockResolvedValueOnce({ user: null });
    expect((await GET(request())).status).toBe(401);
    requireApiPermission.mockResolvedValueOnce({ user: { id: "u" }, forbidden: true });
    expect((await GET(request())).status).toBe(403);
    expect(sendSlackDM).not.toHaveBeenCalled();
  });

  it("only logs while the flag is off: nothing sent, nothing recorded", async () => {
    setup({ featureFlags: [flag(false)] });
    expect(await (await GET(request())).json()).toEqual({ sent: 0, dryRun: 2 });
    expect(sendSlackDM).not.toHaveBeenCalled();
    expect(dataset.notificationLog).toEqual([]);
  });

  it("sends to everyone once the flag is on for everyone, and a second run sends nothing", async () => {
    setup({ featureFlags: [flag(true)] });
    expect(await (await GET(request())).json()).toEqual({ sent: 2, dryRun: 0 });
    expect(await (await GET(request())).json()).toEqual({ sent: 0, dryRun: 0 });
    expect(sendSlackDM).toHaveBeenCalledTimes(2);
  });
});
