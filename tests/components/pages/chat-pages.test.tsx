// @vitest-environment jsdom
/**
 * The chat shell and channel pages (read-only Slack mirror): behind the `chat` flag, scoped to
 * the conversations the member is in plus public ones, tombstones and hidden content, threads,
 * paging, and what is hidden in sudo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import {
  MEMBER_IDENTITY,
  MEMBER_USER,
  expectRedirect,
  notFound,
  resetServerPageMocks,
  signInAs,
  useFakeSupabase,
  type FakeQuery,
  type FakeSupabase,
  type FakeTables,
} from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/supabase/client", () => import("@/tests/helpers/chat-live").then((m) => m.supabaseClientModule));
vi.mock("@/lib/badges", async (original) => ({
  ...(await original<typeof import("@/lib/badges")>()),
  getAttendedPrickleCount: vi.fn(async () => 12),
  getMemberBadges: vi.fn(async () => earnedBadges),
}));
vi.mock("@/app/(member)/chat/actions", () => ({
  markChatRead: vi.fn(),
  loadOlderChat: vi.fn(),
  sendChatMessage: vi.fn(),
  retryChatMessage: vi.fn(),
}));
vi.mock("@/lib/chat/live", () => import("@/tests/helpers/chat-live").then((m) => m.chatLiveModule));

const EMPTY_CTX = { userNames: {}, userMembers: {}, channelIds: {}, channelNames: {}, customEmoji: {} };
const EXAMPLE_VIEW = {
  id: "x",
  authorMemberId: "member-gale",
  authorName: "Gale Prickleton",
  authorPhotoUrl: null,
  replyAuthors: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  editedAt: null,
  body: "text",
  contentState: "ok" as const,
  hasFiles: false,
  replyCount: 0,
  lastReplyAt: null,
  reactions: [],
  syncStatus: null,
  mine: false,
};

let earnedBadges: unknown[] = [];
let sudoMemberHasFlag = true;
/** The member's read marker for a conversation (null = never read: counts from joining). */
let readMarker: string | null = null;
let unread: { channel_id: string; unread: number }[] = [];
vi.mock("@/lib/features.server", () => ({
  getUserFeaturePreviews: vi.fn(),
  effectiveMemberHasFeature: async (key: string, identity: { isSudo: boolean }, own: string[]) =>
    identity.isSudo ? sudoMemberHasFlag : own.includes(key),
}));
// The live-update subscription needs a browser Supabase client; see tests/components/ChatLive.test.tsx.
vi.mock("@/components/chat/ChatLive", () => ({ default: () => null }));
// Service-role name lookups (bronze.slack_users etc.) are stubbed.
vi.mock("@/lib/chat/names", () => ({
  slackUserNames: vi.fn(async () => ({ U_GALE: "Gale Prickleton" })),
  slackAuthorIdsByTs: vi.fn(async () => ({ "300.000": "B_APP" })),
  customEmojiFor: vi.fn(async () => ({})),
  slackUserPhotos: vi.fn(async () => ({})),
  slackUserMemberIds: vi.fn(async () => ({})),
  slackChannelNames: vi.fn(async () => ({})),
}));

const { getUserFeaturePreviews } = await import("@/lib/features.server");
const { loadOlderChat } = await import("@/app/(member)/chat/actions");
const { getMemberBadges } = await import("@/lib/badges");
const { default: ChatLayout } = await import("@/app/(member)/chat/layout");
const { default: ChatIndexPage } = await import("@/app/(member)/chat/page");
const { default: ChatChannelPage } = await import("@/app/(member)/chat/[id]/page");
const { default: ChatMembersPage } = await import("@/app/(member)/chat/[id]/members/page");

const id = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const GENERAL = id(1);
const HOSTS = id(2);
const SECRET = id(3);
const QUIET = id(4);
const GROUP = id(5);

const channel = (cid: string, extra: Record<string, unknown>) => ({
  id: cid, kind: "channel", visibility: "public", restricted: false, name: null, archived_at: null, slack_channel_id: null, ...extra,
});
const CHANNELS = [
  channel(GENERAL, { name: "general", slack_channel_id: "C_GENERAL" }),
  channel(HOSTS, { name: "hosts", visibility: "private", slack_channel_id: "C_HOSTS" }),
  channel(SECRET, { name: "secret", visibility: "private", slack_channel_id: "C_SECRET" }),
  channel(QUIET, { name: "quiet", visibility: "private", restricted: true, slack_channel_id: "C_QUIET" }),
  channel(GROUP, { kind: "group_dm", visibility: "private", restricted: true, slack_channel_id: "G_GROUP" }),
];
const JOINED = [HOSTS, QUIET, GROUP];

const msg = (n: number, extra: Record<string, unknown> = {}) => ({
  id: id(100 + n),
  author_member_id: "member-gale",
  slack_ts: `${n}.000`,
  created_at: `2026-10-0${Math.min(n, 9)}T12:00:00Z`,
  edited_at: null,
  deleted_at: null,
  reply_count: 0,
  last_reply_at: null,
  has_files: false,
  chat_message_contents: { body: `message ${n}` },
  ...extra,
});

let messages: unknown[] = [];
let reactions: unknown[] = [];
let replies: unknown[] = [];
let fake: FakeSupabase;

const eqArg = (q: FakeQuery, col: string) => q.calls.find((c) => c.method === "eq" && c.args[0] === col)?.args[1];

const fakeTables = (): FakeTables => ({
  "rpc:chat_unread_counts": () => ({ data: unread }),
  chat_channels: (q) => {
    const wanted = eqArg(q, "id");
    return { data: wanted ? CHANNELS.filter((c) => c.id === wanted) : CHANNELS };
  },
  chat_channel_members: (q) => {
    const channelId = eqArg(q, "channel_id") as string | undefined;
    if (channelId && eqArg(q, "member_id")) {
      return { data: JOINED.includes(channelId) ? [{ channel_id: channelId, last_read_at: readMarker, joined_at: "2026-01-01T00:00:00Z" }] : [] };
    }
    if (eqArg(q, "member_id")) return { data: JOINED.map((c) => ({ channel_id: c })) };
    return { data: [{ channel_id: GROUP, member_id: "member-fern" }, { channel_id: GROUP, member_id: "member-gale" }] };
  },
  member_directory: (q) => {
    const rows = [
      { id: "member-gale", name: "Gale Prickleton", display_name: null, photo_url: "https://photos.example.test/gale.jpg" },
      { id: "member-fern", name: "Fern Quillsby", display_name: "Fern", photo_url: null },
      {
        id: id(900),
        name: "Hazel Burrows",
        display_name: null,
        photo_url: null,
        bio: "Writes cozy mysteries.\nEarly mornings.",
        first_joined_at: "2025-03-15",
        total_active_months: 19,
        instagram_url: "https://instagram.example.test/hazel",
        facebook_url: null,
        twitter_url: "javascript:alert(1)",
      },
    ];
    const wanted = eqArg(q, "id");
    return { data: wanted ? rows.filter((r) => r.id === wanted) : rows };
  },
  member_ask_me_about: { data: { topics: ["cozy mysteries", "morning routines"] } },
  chat_messages: (q) => {
    if (q.calls.some((c) => c.method === "in" && c.args[0] === "thread_root_id")) return { data: replies };
    const wanted = eqArg(q, "id");
    return { data: wanted ? (messages as { id: string }[]).filter((m) => m.id === wanted) : messages };
  },
  chat_reactions: () => ({ data: reactions }),
});

async function renderChannel(cid: string, search: Record<string, string> = {}) {
  const ui = await ChatChannelPage({ params: Promise.resolve({ id: cid }), searchParams: Promise.resolve(search) });
  return render(ui);
}

beforeEach(() => {
  resetServerPageMocks();
  sudoMemberHasFlag = true;
  readMarker = null;
  unread = [];
  earnedBadges = [];
  messages = [];
  reactions = [];
  replies = [];
  vi.mocked(getUserFeaturePreviews).mockResolvedValue(["chat"]);
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  fake = useFakeSupabase(fakeTables());
});

describe("chat shell", () => {
  it("is a 404 without the chat flag, on the layout and on every page", async () => {
    vi.mocked(getUserFeaturePreviews).mockResolvedValue([]);
    await expect(ChatLayout({ children: null })).rejects.toThrow("404");
    await expect(ChatIndexPage()).rejects.toThrow("404");
    await expect(ChatChannelPage({ params: Promise.resolve({ id: GENERAL }), searchParams: Promise.resolve({}) })).rejects.toThrow("404");
  });

  it("sends signed-out visitors to login", async () => {
    signInAs(null);
    await expectRedirect(ChatIndexPage, undefined, "/login");
  });

  it("lists public channels and the member's own conversations, and nothing else", async () => {
    render(await ChatLayout({ children: <p>content</p> }));
    const nav = screen.getByRole("navigation", { name: "Conversations" });

    expect(within(nav).getByRole("link", { name: "#general" })).toHaveAttribute("href", `/chat/${GENERAL}`);
    expect(within(nav).getByRole("link", { name: /#hosts/ })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Gale Prickleton" })).toHaveAttribute("href", `/chat/${GROUP}`);
    expect(within(nav).queryByText("#secret")).not.toBeInTheDocument();
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("shows unread counts beside the conversations that have some, and none in sudo", async () => {
    unread = [{ channel_id: GENERAL, unread: 3 }];
    render(await ChatLayout({ children: null }));
    const nav = screen.getByRole("navigation", { name: "Conversations" });
    expect(within(nav).getByRole("link", { name: "#general, 3 unread" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: /#hosts/ })).not.toHaveAccessibleName(/unread/);
    cleanup();

    signInAs(MEMBER_USER, { ...MEMBER_IDENTITY, isSudo: true });
    fake.queries.length = 0;
    render(await ChatLayout({ children: null }));
    expect(screen.queryByRole("link", { name: /unread/ })).not.toBeInTheDocument();
    expect(fake.queries.some((q) => q.table === "rpc:chat_unread_counts")).toBe(false);
  });

  it("hides group messages while viewing as a member", async () => {
    signInAs(MEMBER_USER, { ...MEMBER_IDENTITY, isSudo: true });
    render(await ChatLayout({ children: null }));
    const nav = screen.getByRole("navigation", { name: "Conversations" });
    expect(within(nav).getByRole("link", { name: "#general" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Gale Prickleton" })).not.toBeInTheDocument();
  });

  it("follows the viewed member's flag in sudo", async () => {
    signInAs(MEMBER_USER, { ...MEMBER_IDENTITY, isSudo: true });
    sudoMemberHasFlag = false;
    await expect(ChatLayout({ children: null })).rejects.toThrow("404");
  });
});

describe("the line between read and new", () => {
  // Newest first, as the database returns them: messages 1 to 3 on Oct 1 to 3, 12:00.
  const three = () => [msg(3), msg(2), msg(1)];
  const line = () => screen.queryByRole("separator", { name: "New messages" });

  it("sits above the first message newer than the member's read marker", async () => {
    messages = three();
    readMarker = "2026-10-02T12:00:00Z";
    await renderChannel(HOSTS);
    expect(line()).toBeInTheDocument();
    expect(line()!.nextElementSibling).toHaveAttribute("id", `m-${id(103)}`);
    expect(line()!.previousElementSibling).toHaveAttribute("id", `m-${id(102)}`);
  });

  it("is not drawn for a public channel the member is not in (no read marker to compare with)", async () => {
    messages = three();
    await renderChannel(GENERAL);
    expect(line()).not.toBeInTheDocument();
  });

  it("goes above the oldest message when nothing has been read, and is absent when everything has", async () => {
    messages = three();
    readMarker = null;
    await renderChannel(HOSTS);
    expect(line()!.nextElementSibling).toHaveAttribute("id", `m-${id(101)}`);
    cleanup();

    readMarker = "2026-10-03T12:00:00Z";
    await renderChannel(HOSTS);
    expect(line()).not.toBeInTheDocument();
  });

  it("skips the member's own messages and deleted ones when placing it", async () => {
    messages = [msg(3), msg(2, { author_member_id: "member-fern" }), msg(1)];
    readMarker = "2026-10-01T12:00:00Z";
    await renderChannel(HOSTS);
    expect(line()!.nextElementSibling).toHaveAttribute("id", `m-${id(103)}`);
    cleanup();

    messages = [msg(3, { deleted_at: "2026-10-04T00:00:00Z" }), msg(2, { author_member_id: "member-fern" }), msg(1)];
    await renderChannel(HOSTS);
    expect(line()).not.toBeInTheDocument();
  });

  it("is not drawn in sudo (the marker is the signed-in member's, not the viewed one's) or on an older page", async () => {
    messages = three();
    readMarker = "2026-10-01T12:00:00Z";
    await renderChannel(HOSTS, { before: "2026-10-05T00:00:00Z" });
    expect(line()).not.toBeInTheDocument();
    cleanup();

    signInAs(MEMBER_USER, { ...MEMBER_IDENTITY, isSudo: true });
    await renderChannel(HOSTS);
    expect(line()).not.toBeInTheDocument();
  });
});

describe("channel page", () => {
  it("shows messages with authors, formatting, mentions, reactions, replies, tombstones and unreadable messages", async () => {
    messages = [
      msg(1, { chat_message_contents: { body: "Hello *world* <@U_GALE> :tada:" }, reply_count: 2, last_reply_at: "2026-10-03T12:00:00Z" }),
      msg(2, { deleted_at: "2026-10-02T13:00:00Z", chat_message_contents: null }),
      msg(3, { chat_message_contents: null }),
      msg(4, { author_member_id: null, slack_ts: "300.000", has_files: true, chat_message_contents: { body: "from an app" } }),
    ];
    reactions = [
      { message_id: id(101), emoji: "tada", member_id: "member-fern" },
      { message_id: id(101), emoji: "tada", member_id: "member-gale" },
      { message_id: id(101), emoji: "eyes", member_id: "member-gale" },
    ];
    replies = [
      { thread_root_id: id(101), author_member_id: "member-fern", slack_ts: "1.1" },
      { thread_root_id: id(101), author_member_id: "member-fern", slack_ts: "1.2" },
      { thread_root_id: id(101), author_member_id: "member-gale", slack_ts: "1.3" },
    ];
    await renderChannel(GENERAL);

    expect(screen.getByRole("heading", { name: "#general" })).toBeInTheDocument();
    const first = document.getElementById(`m-${id(101)}`)!;
    expect(within(first).getByText("Gale Prickleton")).toBeInTheDocument();
    expect(within(first).getByText("world").tagName).toBe("STRONG");
    expect(within(first).getByText("@Gale Prickleton")).toBeInTheDocument();
    const chips = within(first).getAllByRole("listitem").map((li) => li.textContent);
    expect(chips).toEqual(["🎉 2", "👀 1"]);
    expect(within(first).getByRole("link", { name: /2 replies/ })).toHaveAttribute("href", `/chat/${GENERAL}?thread=${id(101)}`);
    // The author's photo, and one avatar per distinct replier (Fern has no photo: initials).
    expect(first.querySelectorAll('img[src="https://photos.example.test/gale.jpg"]').length).toBeGreaterThanOrEqual(1);
    const stack = within(first).getByRole("link", { name: /2 replies/ }).querySelectorAll("[title]");
    expect([...stack].map((el) => el.getAttribute("title"))).toEqual(["Fern", "Gale Prickleton"]);

    expect(within(document.getElementById(`m-${id(102)}`)!).getByText("This message was deleted.")).toBeInTheDocument();
    expect(within(document.getElementById(`m-${id(103)}`)!).getByText("You can't read this message.")).toBeInTheDocument();

    const fromApp = document.getElementById(`m-${id(104)}`)!;
    expect(within(fromApp).getByText("Slack app")).toBeInTheDocument();
    expect(within(fromApp).getByText(/Includes files/)).toBeInTheDocument();
  });

  it("carries no note about staff access on any conversation (the privacy page covers that)", async () => {
    for (const [cid, heading] of [[HOSTS, "#hosts"], [QUIET, "#quiet"], [GROUP, "Gale Prickleton"]]) {
      document.body.innerHTML = "";
      await renderChannel(cid);
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
      expect(screen.queryByText(/staff/i)).not.toBeInTheDocument();
    }
  });

  it("offers older messages when the page is full, from a cursor on the oldest one shown", async () => {
    // Newest first, 41 rows: one more than a page.
    messages = Array.from({ length: 41 }, (_, i) => msg(41 - i, { created_at: new Date(Date.UTC(2026, 9, 1, 0, 41 - i)).toISOString() }));
    await renderChannel(GENERAL);

    expect(screen.getByRole("button", { name: "Load older messages" })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(40);
    expect(screen.queryByText("message 1")).not.toBeInTheDocument();

    // The oldest of the 40 shown is the cursor; the 41st is on the next page.
    vi.mocked(loadOlderChat).mockResolvedValue({
      views: [{ ...EXAMPLE_VIEW, id: "older-1", body: "from the next page", createdAt: "2026-10-01T00:01:00.000Z" }],
      ctx: EMPTY_CTX,
      olderBefore: null,
    });
    await userEvent.click(screen.getByRole("button", { name: "Load older messages" }));
    expect(loadOlderChat).toHaveBeenCalledWith(GENERAL, "2026-10-01T00:02:00.000Z");
    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(41);
    expect(articles[0]).toHaveTextContent("from the next page");
    expect(screen.queryByRole("button", { name: /older messages/ })).not.toBeInTheDocument();
  });

  it("passes ?before= through as a cursor and ignores junk", async () => {
    await renderChannel(GENERAL, { before: "2026-10-05T00:00:00Z" });
    expect(fake.queries.find((q) => q.table === "chat_messages")!.calls).toContainEqual({ method: "lt", args: ["created_at", "2026-10-05T00:00:00.000Z"] });

    fake.queries.length = 0;
    await renderChannel(GENERAL, { before: "not-a-date" });
    expect(fake.queries.find((q) => q.table === "chat_messages")!.calls.some((c) => c.method === "lt")).toBe(false);
  });

  it("opens a thread in a right panel beside the messages, which stay put", async () => {
    messages = [msg(1, { reply_count: 1 }), msg(2, { thread_root_id: id(101), chat_message_contents: { body: "the reply" } })];
    await renderChannel(GENERAL, { thread: id(101) });

    expect(screen.getByRole("region", { name: "Messages" })).toBeInTheDocument();
    const panel = within(screen.getByRole("complementary", { name: "Thread" }));
    expect(panel.getByRole("link", { name: "Close thread" })).toHaveAttribute("href", `/chat/${GENERAL}`);
    expect(panel.getByText("the reply")).toBeInTheDocument();
    expect(panel.queryByRole("link", { name: /repl/ })).not.toBeInTheDocument();
  });

  it("keeps ?before= when a panel is closed, so the reader stays on the older page", async () => {
    messages = [msg(1, { reply_count: 1 })];
    await renderChannel(GENERAL, { thread: id(101), before: "2026-10-05T00:00:00Z" });
    expect(screen.getByRole("link", { name: "Close thread" })).toHaveAttribute(
      "href",
      `/chat/${GENERAL}?before=${encodeURIComponent("2026-10-05T00:00:00Z")}`,
    );
  });

  describe("posting (behind the chat_posting preview)", () => {
    const composer = () => screen.queryByRole("textbox", { name: "Message #hosts" });

    it("offers a message box in a conversation the member is in, only with the chat_posting flag", async () => {
      messages = [msg(1)];
      await renderChannel(HOSTS);
      expect(composer()).not.toBeInTheDocument();
      cleanup();

      vi.mocked(getUserFeaturePreviews).mockResolvedValue(["chat", "chat_posting"]);
      await renderChannel(HOSTS);
      expect(composer()).toBeInTheDocument();
    });

    it("offers none in a public channel the member hasn't joined, or in sudo", async () => {
      vi.mocked(getUserFeaturePreviews).mockResolvedValue(["chat", "chat_posting"]);
      messages = [msg(1)];
      await renderChannel(GENERAL);
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      cleanup();

      signInAs(MEMBER_USER, { ...MEMBER_IDENTITY, isSudo: true });
      await renderChannel(HOSTS);
      expect(composer()).not.toBeInTheDocument();
    });

    it("offers a reply box in a thread whose root is in Slack, and none while the root is still sending", async () => {
      vi.mocked(getUserFeaturePreviews).mockResolvedValue(["chat", "chat_posting"]);
      messages = [msg(1, { reply_count: 1 })];
      await renderChannel(HOSTS, { thread: id(101) });
      expect(within(screen.getByRole("complementary", { name: "Thread" })).getByRole("textbox", { name: "Reply…" })).toBeInTheDocument();
      cleanup();

      messages = [msg(1, { slack_ts: null, slack_sync_status: "pending", reply_count: 0 })];
      await renderChannel(HOSTS, { thread: id(101) });
      const panel = within(screen.getByRole("complementary", { name: "Thread" }));
      expect(panel.queryByRole("textbox")).not.toBeInTheDocument();
      expect(panel.getAllByText("Sending to Slack…").length).toBeGreaterThan(0);
    });

    it("says a failed message didn't reach Slack, with a retry for its author only", async () => {
      messages = [
        msg(1, { slack_ts: null, slack_sync_status: "failed", author_member_id: MEMBER_IDENTITY.memberId }),
        msg(2, { slack_ts: null, slack_sync_status: "failed" }),
      ];
      await renderChannel(HOSTS);
      expect(screen.getAllByText(/Slack didn't get this message/)).toHaveLength(2);
      expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
    });
  });

  it("opens a member's profile in the right panel: how long they've been a Hedgie, bio, topics and links", async () => {
    messages = [msg(1)];
    await renderChannel(GENERAL, { profile: id(900) });

    const panel = within(screen.getByRole("complementary", { name: "Profile" }));
    expect(panel.getByText("Hazel Burrows")).toBeInTheDocument();
    expect(panel.getByText("Hedgie since March 2025")).toBeInTheDocument();
    expect(panel.getByText(/Writes cozy mysteries\./)).toBeInTheDocument();
    expect(panel.getByRole("link", { name: "cozy mysteries" })).toHaveAttribute("href", "/members?q=cozy%20mysteries");
    expect(panel.getByRole("link", { name: "Instagram" })).toHaveAttribute("href", "https://instagram.example.test/hazel");
    // Unsafe or missing links are not shown.
    expect(panel.queryByRole("link", { name: /Facebook|Twitter/ })).not.toBeInTheDocument();
    expect(panel.getByRole("link", { name: "View full profile" })).toHaveAttribute("href", `/members/${id(900)}`);
    expect(panel.getByRole("link", { name: "Close profile" })).toHaveAttribute("href", `/chat/${GENERAL}`);
  });

  it("shows the badges the member has earned, computed as on the full profile, with a retreat badge linking to its event", async () => {
    earnedBadges = [
      { badgeType: { id: "b1", key: "retreat", name: "Retreat", description: null, icon: "⛺", category: "retreat", event_slug: "spring-retreat" }, levelName: "Spring Retreat", level: null, occurrences: 1, firstAwardedAt: null, lastAwardedAt: null, note: null },
      { badgeType: { id: "b2", key: "founder", name: "Founding Hedgie", description: null, icon: "🌱", category: "milestone" }, levelName: "Founding Hedgie", level: null, occurrences: 1, firstAwardedAt: null, lastAwardedAt: null, note: null },
    ];
    messages = [msg(1)];
    await renderChannel(GENERAL, { profile: id(900) });

    const panel = within(screen.getByRole("region", { name: "Badges" }));
    expect(panel.getByRole("link", { name: /Spring Retreat/ })).toHaveAttribute("href", "/events/spring-retreat");
    expect(panel.getByText("Founding Hedgie")).toBeInTheDocument();
    expect(getMemberBadges).toHaveBeenCalledWith(expect.anything(), id(900), 12, "2025-03-15");
  });

  it("has no badges section for a member with none", async () => {
    messages = [msg(1)];
    await renderChannel(GENERAL, { profile: id(900) });
    expect(screen.queryByRole("region", { name: "Badges" })).not.toBeInTheDocument();
  });

  it("says so when the profile's member isn't in the directory", async () => {
    messages = [msg(1)];
    await renderChannel(GENERAL, { profile: id(901) });
    expect(within(screen.getByRole("complementary", { name: "Profile" })).getByText("This member isn't available.")).toBeInTheDocument();
  });

  it("opens no panel for a bad profile id, and a thread wins over a profile", async () => {
    messages = [msg(1, { reply_count: 1 })];
    await renderChannel(GENERAL, { profile: "not-a-uuid" });
    expect(screen.queryByRole("complementary", { name: "Profile" })).not.toBeInTheDocument();
    cleanup();
    await renderChannel(GENERAL, { thread: id(101), profile: id(900) });
    expect(screen.getByRole("complementary", { name: "Thread" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Profile" })).not.toBeInTheDocument();
  });

  it("is a 404 for a private conversation the member isn't in, a bad id, an unknown thread, or an unknown channel", async () => {
    await expect(renderChannel(SECRET)).rejects.toThrow("404");
    await expect(renderChannel("not-a-uuid")).rejects.toThrow("404");
    await expect(renderChannel(id(99))).rejects.toThrow("404");
    await expect(renderChannel(GENERAL, { thread: id(555) })).rejects.toThrow("404");
    expect(notFound).toHaveBeenCalled();
  });

  it("in sudo hides a restricted conversation's messages without even asking for them", async () => {
    signInAs(MEMBER_USER, { ...MEMBER_IDENTITY, isSudo: true });
    await renderChannel(QUIET);

    expect(screen.getByText(/restricted, so its messages are hidden while you view as a member/)).toBeInTheDocument();
    expect(fake.queries.some((q) => q.table === "chat_messages")).toBe(false);
  });

  it("in sudo, a group message is a 404", async () => {
    signInAs(MEMBER_USER, { ...MEMBER_IDENTITY, isSudo: true });
    await expect(renderChannel(GROUP)).rejects.toThrow("404");
  });
});

describe("authors and members", () => {
  it("links an author's name and avatar to their profile panel, but not an unmatched Slack author", async () => {
    messages = [msg(1), msg(4, { author_member_id: null, slack_ts: "300.000" })];
    await renderChannel(GENERAL);
    const first = within(document.getElementById(`m-${id(101)}`)!);
    const profile = `/chat/${GENERAL}?profile=member-gale`;
    expect(first.getByRole("link", { name: "Gale Prickleton" })).toHaveAttribute("href", profile);
    expect(first.getAllByRole("link").filter((a) => !/thread=/.test(a.getAttribute("href")!)).every((a) => a.getAttribute("href") === profile)).toBe(true);
    expect(within(document.getElementById(`m-${id(104)}`)!).queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows a members link with the count in the channel header", async () => {
    await renderChannel(GENERAL);
    expect(screen.getByRole("link", { name: "2 members" })).toHaveAttribute("href", `/chat/${GENERAL}/members`);
  });

  it("lists the members, each linking to their profile", async () => {
    render(await ChatMembersPage({ params: Promise.resolve({ id: GENERAL }) }));
    expect(screen.getByRole("heading", { name: /#general members/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Fern/ })).toHaveAttribute("href", "/members/member-fern");
    expect(screen.getByRole("link", { name: /Gale Prickleton/ })).toHaveAttribute("href", "/members/member-gale");
  });

  it("404s the members page for a private conversation the member isn't in", async () => {
    await expect(ChatMembersPage({ params: Promise.resolve({ id: SECRET }) })).rejects.toThrow("404");
  });
});

describe("chat index", () => {
  it("explains the read-only mirror", async () => {
    render(await ChatIndexPage());
    expect(screen.getByRole("heading", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByText(/read-only view of our Slack conversations/)).toBeInTheDocument();
  });
});
