// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { getSearcher, universalSearch, recordSearchTimings } = vi.hoisted(() => ({
  getSearcher: vi.fn(), universalSearch: vi.fn(), recordSearchTimings: vi.fn(),
}));
vi.mock("@/lib/search/context", () => ({ getSearcher }));
vi.mock("@/lib/search/universal", () => ({ universalSearch }));
vi.mock("@/lib/search/metrics", () => ({ recordSearchTimings }));
const { track, trackWhenEnabled } = vi.hoisted(() => ({ track: vi.fn(), trackWhenEnabled: vi.fn(() => () => {}) }));
vi.mock("@/lib/analytics/client", () => ({ track, trackWhenEnabled }));
vi.mock("@/components/search/ResultsSearchBox", () => ({ default: () => <input aria-label="Search" /> }));
vi.mock("@/components/search/PendingLink", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));

import SearchResultsPage from "@/components/search/SearchResultsPage";

beforeEach(() => {
  vi.clearAllMocks();
  getSearcher.mockResolvedValue({ ctx: {}, skip: [], isAdmin: false });
  universalSearch.mockImplementation(async (_ctx, query, { skip, timings }) => {
    if (query.raw) timings[query.kind === "chat" && !skip.includes("chat") ? "chat" : "members"] = 0;
    return [];
  });
});

const search = (q: string, basePath = "/search") => SearchResultsPage({ searchParams: Promise.resolve({ q }), basePath });

describe("search results chat opt-in", () => {
  it.each(["/search", "/admin/search"])("skips chat by default on %s and offers a chat search", async (basePath) => {
    render(await search("hello", basePath));
    expect(universalSearch.mock.calls[0][2].skip).toEqual(["chat"]);
    expect(screen.getByRole("link", { name: "Search chat messages" })).toHaveAttribute("href", `${basePath}?q=hello%20in%3Achat`);
    expect(screen.getByRole("link", { name: "Chat" })).toHaveAttribute("href", `${basePath}?q=hello%20in%3Achat`);
    expect(recordSearchTimings).toHaveBeenCalledWith("results_page", expect.objectContaining({ kindsMs: { members: 0 } }));
  });

  it.each(["in:chat hello", "channel:general hello", "has:link hello", "is:thread hello"])("allows explicitly requested chat: %s", async (q) => {
    render(await search(q));
    expect(universalSearch.mock.calls[0][2].skip).toEqual([]);
    expect(screen.queryByText(/Chat messages aren’t included/)).not.toBeInTheDocument();
  });

  it("keeps feature restrictions when chat is requested", async () => {
    getSearcher.mockResolvedValue({ ctx: {}, skip: ["chat"], isAdmin: false });
    render(await search("in:chat hello"));
    expect(universalSearch.mock.calls[0][2].skip).toEqual(["chat"]);
    expect(screen.queryByRole("link", { name: "Chat" })).not.toBeInTheDocument();
  });

  it.each(["", "in:unknown hello"])("does not record timings for a search that ran nothing: %s", async (q) => {
    await search(q);
    expect(recordSearchTimings).not.toHaveBeenCalled();
  });
});

describe("usage analytics", () => {
  const hit = (kind: string, id: string) => ({ kind, id, title: `${kind} ${id}`, href: `/${kind}/${id}` });

  beforeEach(() => {
    universalSearch.mockResolvedValue([
      { kind: "members", hits: [hit("members", "1"), hit("members", "2")], hasMore: false },
      { kind: "chat", hits: [hit("chat", "3")], hasMore: false },
    ]);
  });

  it("reports the search once, by shape and counts, never the words", async () => {
    render(await search("in:chat from:fern secret lunch"));
    expect(trackWhenEnabled).toHaveBeenCalledTimes(1);
    expect(trackWhenEnabled).toHaveBeenCalledWith("search_ran", {
      surface: "page",
      kind: "chat",
      operators: "from,in",
      words: 2,
      results: 3,
      chat_results: 1,
      chat_searched: true,
    });
    expect(JSON.stringify(trackWhenEnabled.mock.calls)).not.toMatch(/fern|secret|lunch/);
  });

  it("says chat was not searched when it was left out", async () => {
    render(await search("lunch"));
    expect(trackWhenEnabled).toHaveBeenCalledWith("search_ran", expect.objectContaining({ kind: "all", chat_searched: false }));
  });

  it("reports nothing for an empty or unknown-kind search", async () => {
    render(await search(""));
    render(await search("in:nonsense lunch"));
    expect(trackWhenEnabled).not.toHaveBeenCalled();
  });

  it("records opening a result by its kind and its place across the whole page", async () => {
    render(await search("in:chat lunch"));
    fireEvent.click(screen.getByRole("link", { name: "members 2" }));
    fireEvent.click(screen.getByRole("link", { name: "chat 3" }));
    expect(track.mock.calls).toEqual([
      ["search_result_clicked", { surface: "page", kind: "members", rank: 2, via: "click" }],
      ["search_result_clicked", { surface: "page", kind: "chat", rank: 3, via: "click" }],
    ]);
  });

  it("names its tabs and links so their use can be counted", async () => {
    render(await search("lunch"));
    const named = new Set(Array.from(document.querySelectorAll("[data-track]")).map((el) => el.getAttribute("data-track")));
    for (const name of ["search-page-kind-all", "search-page-kind-chat", "search-page-kind-members", "search-page-chat-prompt", "search-page-hit"]) {
      expect(named).toContain(name);
    }
  });
});
