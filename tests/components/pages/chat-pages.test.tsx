// @vitest-environment jsdom
/**
 * The chat shell and channel pages (read-only Slack mirror): behind the `chat` flag, scoped to
 * the conversations the member is in plus public ones, tombstones and hidden content, threads,
 * paging, and what is hidden in sudo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

let sudoMemberHasFlag = true;
vi.mock("@/lib/features.server", () => ({
  getUserFeaturePreviews: vi.fn(),
  effectiveMemberHasFeature: async (key: string, identity: { isSudo: boolean }, own: string[]) =>
    identity.isSudo ? sudoMemberHasFlag : own.includes(key),
}));
// Service-role name lookups (bronze.slack_users etc.) are stubbed.
vi.mock("@/lib/chat/names", () => ({
  slackUserNames: vi.fn(async () => ({ U_GALE: "Gale Prickleton" })),
  slackAuthorIdsByTs: vi.fn(async () => ({ "300.000": "B_APP" })),
}));

const { getUserFeaturePreviews } = await import("@/lib/features.server");
const { default: ChatLayout } = await import("@/app/(member)/chat/layout");
const { default: ChatIndexPage } = await import("@/app/(member)/chat/page");
const { default: ChatChannelPage } = await import("@/app/(member)/chat/[id]/page");

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
let fake: FakeSupabase;

const eqArg = (q: FakeQuery, col: string) => q.calls.find((c) => c.method === "eq" && c.args[0] === col)?.args[1];

const fakeTables = (): FakeTables => ({
  chat_channels: (q) => {
    const wanted = eqArg(q, "id");
    return { data: wanted ? CHANNELS.filter((c) => c.id === wanted) : CHANNELS };
  },
  chat_channel_members: (q) => {
    const channelId = eqArg(q, "channel_id") as string | undefined;
    if (channelId && eqArg(q, "member_id")) return { data: JOINED.includes(channelId) ? [{ channel_id: channelId }] : [] };
    if (eqArg(q, "member_id")) return { data: JOINED.map((c) => ({ channel_id: c })) };
    return { data: [{ channel_id: GROUP, member_id: "member-fern" }, { channel_id: GROUP, member_id: "member-gale" }] };
  },
  member_directory: {
    data: [
      { id: "member-gale", name: "Gale Prickleton", display_name: null },
      { id: "member-fern", name: "Fern Quillsby", display_name: "Fern" },
    ],
  },
  chat_messages: (q) => {
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
  messages = [];
  reactions = [];
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
    await renderChannel(GENERAL);

    expect(screen.getByRole("heading", { name: "#general" })).toBeInTheDocument();
    const first = document.getElementById(`m-${id(101)}`)!;
    expect(within(first).getByText("Gale Prickleton")).toBeInTheDocument();
    expect(within(first).getByText("world").tagName).toBe("STRONG");
    expect(within(first).getByText("@Gale Prickleton")).toBeInTheDocument();
    const chips = within(first).getAllByRole("listitem").map((li) => li.textContent);
    expect(chips).toEqual(["🎉 2", "👀 1"]);
    expect(within(first).getByRole("link", { name: /2 replies/ })).toHaveAttribute("href", `/chat/${GENERAL}?thread=${id(101)}`);

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

  it("offers older messages when the page is full, keyed on the oldest one shown", async () => {
    // Newest first, 41 rows: one more than a page.
    messages = Array.from({ length: 41 }, (_, i) => msg(41 - i, { created_at: new Date(Date.UTC(2026, 9, 1, 0, 41 - i)).toISOString() }));
    await renderChannel(GENERAL);

    const older = screen.getByRole("link", { name: "Load older messages" });
    expect(older.getAttribute("href")).toContain(`/chat/${GENERAL}?before=`);
    expect(screen.getAllByRole("article")).toHaveLength(40);
    // The oldest of the 40 shown is the cursor; the 41st is on the next page.
    expect(decodeURIComponent(older.getAttribute("href")!)).toContain("2026-10-01T00:02:00.000Z");
    expect(screen.queryByText("message 1")).not.toBeInTheDocument();
  });

  it("passes ?before= through as a cursor and ignores junk", async () => {
    await renderChannel(GENERAL, { before: "2026-10-05T00:00:00Z" });
    expect(fake.queries.find((q) => q.table === "chat_messages")!.calls).toContainEqual({ method: "lt", args: ["created_at", "2026-10-05T00:00:00.000Z"] });

    fake.queries.length = 0;
    await renderChannel(GENERAL, { before: "not-a-date" });
    expect(fake.queries.find((q) => q.table === "chat_messages")!.calls.some((c) => c.method === "lt")).toBe(false);
  });

  it("shows a thread: the root, then its replies, with a way back", async () => {
    messages = [msg(1, { reply_count: 1 }), msg(2, { thread_root_id: id(101), chat_message_contents: { body: "the reply" } })];
    await renderChannel(GENERAL, { thread: id(101) });

    expect(screen.getByRole("link", { name: "← Back to #general" })).toHaveAttribute("href", `/chat/${GENERAL}`);
    expect(screen.getByText("the reply")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /repl/ })).not.toBeInTheDocument();
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

describe("chat index", () => {
  it("explains the read-only mirror", async () => {
    render(await ChatIndexPage());
    expect(screen.getByRole("heading", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByText(/read-only view of our Slack conversations/)).toBeInTheDocument();
  });
});
