// @vitest-environment jsdom
/**
 * /chat/search: behind the `chat` flag, scoped to the member's own conversations (and, in sudo,
 * unrestricted channels), passing its filters to search_chat_messages and rendering the hits with
 * a way back into their thread.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  MEMBER_IDENTITY,
  MEMBER_USER,
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
vi.mock("@/lib/features.server", () => ({
  getUserFeaturePreviews: vi.fn(),
  effectiveMemberHasFeature: async (key: string, _identity: unknown, own: string[]) => own.includes(key),
}));
vi.mock("@/lib/chat/names", () => ({
  slackUserNames: vi.fn(async () => ({})),
  slackAuthorIdsByTs: vi.fn(async () => ({})),
  customEmojiFor: vi.fn(async () => ({})),
  slackUserPhotos: vi.fn(async () => ({})),
  slackUserMemberIds: vi.fn(async () => ({})),
  slackChannelNames: vi.fn(async () => ({})),
}));

const { getUserFeaturePreviews } = await import("@/lib/features.server");
const { default: ChatSearchPage } = await import("@/app/(member)/chat/search/page");
const { default: ChatLayout } = await import("@/app/(member)/chat/layout");
const { SEARCH_PAGE_SIZE } = await import("@/lib/chat/search");

const id = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const GENERAL = id(1);
const QUIET = id(2);
const CHANNELS = [
  { id: GENERAL, kind: "channel", visibility: "public", restricted: false, name: "general", archived_at: null, slack_channel_id: "C_GENERAL" },
  { id: QUIET, kind: "channel", visibility: "private", restricted: true, name: "quiet", archived_at: null, slack_channel_id: "C_QUIET" },
];

const row = (n: number, extra: Record<string, unknown> = {}) => ({
  id: id(100 + n),
  channel_id: GENERAL,
  thread_root_id: null,
  author_member_id: "member-gale",
  slack_ts: `${n}.000`,
  created_at: "2026-10-02T12:00:00Z",
  edited_at: null,
  deleted_at: null,
  reply_count: 0,
  last_reply_at: null,
  has_files: false,
  chat_message_contents: { body: `pineapple ${n}` },
  ...extra,
});

let hits: { message_id: string }[] = [];
let rows: unknown[] = [];
let rpcError: unknown = null;
let fake: FakeSupabase;

const fakeTables = (): FakeTables => ({
  chat_channels: { data: CHANNELS },
  chat_channel_members: (q: FakeQuery) =>
    q.calls.some((c) => c.method === "eq" && c.args[0] === "member_id") ? { data: [{ channel_id: QUIET }] } : { data: [] },
  member_directory: (q: FakeQuery) => ({
    data: q.calls.some((c) => c.method === "or") ? [{ id: "member-gale" }] : [{ id: "member-gale", name: "Gale Prickleton", display_name: null, photo_url: null }],
  }),
  "rpc:search_chat_messages": () => ({ data: hits, error: rpcError }),
  chat_messages: { data: [] },
});

const rpcArgs = () =>
  fake.queries.find((q) => q.table === "rpc:search_chat_messages")?.calls[0].args[0] as Record<string, unknown> | undefined;

async function renderSearch(search: Record<string, string> = {}) {
  render(await ChatSearchPage({ searchParams: Promise.resolve(search) }));
}

beforeEach(() => {
  resetServerPageMocks();
  hits = [];
  rows = [];
  rpcError = null;
  vi.mocked(getUserFeaturePreviews).mockResolvedValue(["chat"]);
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  const tables = fakeTables();
  tables.chat_messages = () => ({ data: rows });
  fake = useFakeSupabase(tables);
});

describe("chat search page", () => {
  it("is a 404 without the chat flag", async () => {
    vi.mocked(getUserFeaturePreviews).mockResolvedValue([]);
    await expect(ChatSearchPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("404");
  });

  it("shows the form and runs no search without a query", async () => {
    await renderSearch();
    expect(screen.getByRole("searchbox", { name: "Search messages" })).toBeInTheDocument();
    expect(fake.queries.some((q) => q.table === "rpc:search_chat_messages")).toBe(false);
  });

  it("searches the member's conversations with the filters and renders hits linking into their thread", async () => {
    hits = [{ message_id: id(101) }, { message_id: id(102) }];
    rows = [row(1), row(2, { thread_root_id: id(150) })];
    await renderSearch({ q: "pineapple", from: "2026-10-01", to: "2026-10-31", files: "1", author: "gale" });

    expect(rpcArgs()).toMatchObject({
      p_query: "('pineapple')",
      p_channel_ids: [GENERAL, QUIET],
      p_author_member_ids: ["member-gale"],
      p_from: "2026-10-01T00:00:00.000Z",
      p_to: "2026-11-01T00:00:00.000Z",
      p_has_files: true,
      p_in_thread: null,
      p_limit: SEARCH_PAGE_SIZE + 1,
      p_offset: 0,
    });

    const results = within(screen.getByRole("region", { name: "Results" }));
    expect(results.getByText("pineapple 1")).toBeInTheDocument();
    const open = results.getAllByRole("link", { name: /^Open/ });
    expect(open.map((a) => a.getAttribute("href"))).toEqual([
      `/chat/${GENERAL}?thread=${id(101)}#m-${id(101)}`,
      `/chat/${GENERAL}?thread=${id(150)}#m-${id(102)}`,
    ]);
  });

  it("understands Slack modifiers in the query", async () => {
    hits = [{ message_id: id(101) }];
    rows = [row(1)];
    await renderSearch({ q: 'in:#general from:me "big news" -spoilers has:link after:2026-10-01' });
    expect(rpcArgs()).toMatchObject({
      p_query: "('big' <-> 'news') & !('spoilers')",
      p_channel_ids: [GENERAL],
      p_author_member_ids: [MEMBER_IDENTITY.memberId],
      p_from: "2026-10-02T00:00:00.000Z",
      p_has_link: true,
    });
  });

  it("searches nothing for an unknown in: channel, and runs filters-only searches", async () => {
    await renderSearch({ q: "in:#nowhere hello" });
    expect(rpcArgs()).toBeUndefined();
    await renderSearch({ q: "from:fern" });
    expect(rpcArgs()).toMatchObject({ p_query: "", p_author_member_ids: ["member-gale"] });
  });

  it("offers more results only when there are more", async () => {
    hits = Array.from({ length: SEARCH_PAGE_SIZE + 1 }, (_, i) => ({ message_id: id(100 + i) }));
    rows = hits.map((_, i) => row(i));
    await renderSearch({ q: "pineapple" });
    expect(screen.getByRole("link", { name: /More results/ })).toHaveAttribute("href", "/chat/search?q=pineapple&page=1");
  });

  it("says so when nothing matches", async () => {
    await renderSearch({ q: "nothing" });
    expect(screen.getByText(/No messages match/)).toBeInTheDocument();
  });

  it("searches no restricted conversation while viewing as a member", async () => {
    signInAs(MEMBER_USER, { ...MEMBER_IDENTITY, isSudo: true });
    vi.mocked(getUserFeaturePreviews).mockResolvedValue(["chat"]);
    await renderSearch({ q: "pineapple" });
    expect(rpcArgs()?.p_channel_ids).toEqual([GENERAL]);
  });

  it("ignores an unknown channel filter's id and searches everything", async () => {
    await renderSearch({ q: "pineapple", channel: "not-a-uuid" });
    expect(rpcArgs()?.p_channel_ids).toEqual([GENERAL, QUIET]);
  });

  it("has a search box in the chat sidebar", async () => {
    render(await ChatLayout({ children: null }));
    expect(screen.getByRole("searchbox", { name: "Search chat" })).toBeInTheDocument();
  });
});
