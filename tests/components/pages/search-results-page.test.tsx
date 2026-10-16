// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { getSearcher, universalSearch, recordSearchTimings } = vi.hoisted(() => ({
  getSearcher: vi.fn(), universalSearch: vi.fn(), recordSearchTimings: vi.fn(),
}));
vi.mock("@/lib/search/context", () => ({ getSearcher }));
vi.mock("@/lib/search/universal", () => ({ universalSearch }));
vi.mock("@/lib/search/metrics", () => ({ recordSearchTimings }));
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
