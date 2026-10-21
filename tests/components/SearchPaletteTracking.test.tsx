// @vitest-environment jsdom
/** What the search palette reports for usage analytics: how it was opened, what each search looked like and what was done with it, never the words typed. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/dashboard" }));

const searchPalette = vi.fn();
const searchSuggestions = vi.fn();
const suggestOperatorValues = vi.fn();
vi.mock("@/app/actions/search", () => ({
  searchPalette: (q: string) => searchPalette(q),
  searchSuggestions: () => searchSuggestions(),
  suggestOperatorValues: (op: string, typed: string) => suggestOperatorValues(op, typed),
  markSuggestionsRead: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@sentry/nextjs", () => ({ metrics: { distribution: vi.fn() } }));
const track = vi.fn();
vi.mock("@/lib/analytics/client", () => ({ track: (...args: unknown[]) => track(...args) }));

import SearchPalette from "@/components/search/SearchPalette";

const members = { kind: "members", hasMore: true, hits: [{ kind: "members", id: "m1", title: "Fern Quillsby", href: "/members/m1" }] };
const chat = {
  kind: "chat",
  hasMore: false,
  hits: [
    { kind: "chat", id: "c1", title: "A message", href: "/chat/1#m-c1" },
    { kind: "chat", id: "c2", title: "Another", href: "/chat/1#m-c2" },
  ],
};

const names = () => track.mock.calls.map((c) => c[0]);
const callsOf = (name: string) => track.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

async function openPalette() {
  const user = userEvent.setup();
  render(<SearchPalette resultsPath="/search" isAdmin={false} />);
  await user.click(screen.getByRole("button", { name: "Search" }));
  return user;
}

const box = () => screen.getByRole("textbox", { name: "Search" });

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  push.mockReset();
  track.mockReset();
  searchPalette.mockReset().mockResolvedValue({ results: [members] });
  searchSuggestions.mockReset().mockResolvedValue({ needsAttention: [] });
  suggestOperatorValues.mockReset().mockResolvedValue([]);
  localStorage.clear();
});

afterEach(() => vi.useRealTimers());

describe("opening", () => {
  it("records how the palette was opened, and not a second time while it is open", async () => {
    const user = await openPalette();
    expect(callsOf("search_opened")).toEqual([{ via: "button" }]);
    await user.click(box());
    await user.keyboard("{Escape}");
    await user.keyboard("{Control>}k{/Control}");
    expect(callsOf("search_opened")).toEqual([{ via: "button" }, { via: "shortcut_k" }]);
    await user.keyboard("{Control>}k{/Control}");
    await user.keyboard("/");
    expect(callsOf("search_opened")).toEqual([{ via: "button" }, { via: "shortcut_k" }, { via: "shortcut_slash" }]);
  });
});

describe("a search", () => {
  it("is one event, with the shape of the query and its results, once typing settles", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // fireEvent, not userEvent: Testing Library's async helpers wait on a real timer, which is faked here.
    render(<SearchPalette resultsPath="/search" isAdmin={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(box(), { target: { value: "fern from:me" } });

    await vi.advanceTimersByTimeAsync(200);
    expect(screen.getByRole("heading", { name: "Members" })).toBeInTheDocument();
    expect(callsOf("search_ran")).toEqual([]);

    await vi.advanceTimersByTimeAsync(800);
    expect(callsOf("search_ran")).toEqual([
      { surface: "palette", kind: "all", operators: "from", words: 1, results: 1, chat_results: 0, chat_searched: false },
    ]);
  });

  it("counts chat results and says whether chat was searched", async () => {
    searchPalette.mockResolvedValue({ results: [chat], chatSearched: true });
    const user = await openPalette();
    await user.type(box(), "in:chat lunch");
    await screen.findByRole("heading", { name: "Chat" });
    await user.keyboard("{Escape}");
    expect(callsOf("search_ran")).toEqual([
      { surface: "palette", kind: "chat", operators: "in", words: 1, results: 2, chat_results: 2, chat_searched: true },
    ]);
  });

  it("is reported when the palette closes before typing settles, and not again on reopening to the same query", async () => {
    const user = await openPalette();
    await user.type(box(), "fern");
    await screen.findByRole("heading", { name: "Members" });
    await user.keyboard("{Escape}");
    expect(callsOf("search_ran")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByRole("heading", { name: "Members" });
    await user.keyboard("{Escape}");
    expect(callsOf("search_ran")).toHaveLength(1);
  });

  it("reports the search before the result that was opened, by click or by Enter", async () => {
    searchPalette.mockResolvedValue({ results: [members, chat] });
    const user = await openPalette();
    await user.type(box(), "fern");
    await screen.findByRole("heading", { name: "Chat" });

    await user.click(screen.getByRole("link", { name: /Another/ }));
    expect(names().filter((n) => n === "search_ran" || n === "search_result_clicked")).toEqual(["search_ran", "search_result_clicked"]);
    expect(callsOf("search_result_clicked")).toEqual([{ surface: "palette", kind: "chat", rank: 3, via: "click" }]);

    track.mockClear();
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(box());
    await user.keyboard("{ArrowDown}{Enter}");
    expect(callsOf("search_result_clicked")).toEqual([{ surface: "palette", kind: "members", rank: 1, via: "enter" }]);
    expect(push).toHaveBeenLastCalledWith("/members/m1");
  });

  it("never sends what was typed", async () => {
    searchPalette.mockResolvedValue({ results: [members, chat], chatSearched: true });
    const user = await openPalette();
    await user.type(box(), 'in:chat from:fern@example.test "secret phrase" lunch');
    await screen.findByRole("heading", { name: "Chat" });
    await user.click(screen.getByRole("link", { name: /A message/ }));
    const sent = JSON.stringify(track.mock.calls);
    for (const word of ["fern", "example", "secret", "phrase", "lunch"]) expect(sent).not.toContain(word);
  });
});

describe("suggestions", () => {
  it("records opening a needs-attention item, a recent place and a recent search, with their place in the list", async () => {
    localStorage.setItem("hub:recent-places", JSON.stringify([{ href: "/members", title: "Members" }]));
    searchSuggestions.mockResolvedValue({
      needsAttention: [{ id: "n1", kind: "notification", title: "Something new", href: "/notifications" }],
    });
    const user = await openPalette();
    await user.click(await screen.findByRole("link", { name: /Something new/ }));
    expect(callsOf("search_suggestion_clicked")).toEqual([{ source: "needs_attention", kind: "notification", rank: 1, via: "click" }]);
  });

  it("records choosing a recent search", async () => {
    localStorage.setItem("hub:recent-searches", JSON.stringify(["fern lunch"]));
    const user = await openPalette();
    await user.click(screen.getByRole("button", { name: "Show search history" }));
    await user.click(await screen.findByRole("button", { name: "fern lunch" }));
    expect(callsOf("search_suggestion_clicked")).toEqual([{ source: "recent_search", kind: "search", rank: 1, via: "click" }]);
    expect(JSON.stringify(track.mock.calls)).not.toContain("lunch");
  });
});

describe("filters", () => {
  async function withFilters() {
    const user = await openPalette();
    await user.click(screen.getByRole("button", { name: "Show filters" }));
    track.mockClear();
    return user;
  }

  it("records the kind, a quick chip, From…, the time range and a + option, by name only", async () => {
    const user = await withFilters();
    await user.selectOptions(screen.getByLabelText("Search in"), "members");
    await user.click(screen.getByRole("button", { name: "From me" }));
    await user.click(screen.getByRole("button", { name: "From…" }));
    await user.selectOptions(screen.getByLabelText("Time range"), "7");
    await user.click(screen.getByRole("button", { name: "More filters" }));
    await user.click(screen.getByRole("button", { name: /^In channel/ }));
    expect(callsOf("search_filter_used")).toEqual([
      { filter: "kind", option: "members" },
      { filter: "quick_chip", option: "from-me" },
      { filter: "from_button" },
      { filter: "time_range", option: "7d" },
      { filter: "more_option", option: "channel" },
    ]);
  });

  it("records a date picked in + and clearing the kind", async () => {
    const user = await withFilters();
    await user.selectOptions(screen.getByLabelText("Search in"), "books");
    await user.selectOptions(screen.getByLabelText("Search in"), "");
    await user.click(screen.getByRole("button", { name: "More filters" }));
    const date = screen.getByLabelText("After date");
    await user.type(date, "2026-01-02");
    expect(callsOf("search_filter_used")).toEqual(
      expect.arrayContaining([{ filter: "kind", option: "books" }, { filter: "kind", option: "everything" }, { filter: "date", option: "after" }])
    );
  });

  it("records choosing an autocomplete option by the operator, not the value", async () => {
    const user = await openPalette();
    await user.type(box(), "pizza in:pr");
    await waitFor(() => expect(screen.getAllByRole("button").length).toBeGreaterThan(0));
    await user.keyboard("{Tab}");
    expect(callsOf("search_filter_used")).toEqual([{ filter: "completion", option: "in" }]);
  });
});

describe("named controls", () => {
  it("names every palette control so its use and click-through can be counted", async () => {
    searchPalette.mockResolvedValue({ results: [members, chat], chatSearched: true, chatSkipped: true });
    const user = await openPalette();
    await user.click(screen.getByRole("button", { name: "Show filters" }));
    await user.type(box(), "fern");
    await screen.findByRole("heading", { name: "Chat" });
    const named = new Set(Array.from(document.querySelectorAll("[data-track]")).map((el) => el.getAttribute("data-track")));
    for (const name of [
      "search-open", "search-clear", "search-filters-toggle", "search-history-toggle", "search-close",
      "search-filter-kind", "search-chip-from-me", "search-filter-from", "search-filter-time", "search-filter-more",
      "search-hit", "search-show-more", "search-view-all", "search-chat-prompt",
    ]) {
      expect(named, name).toContain(name);
    }
  });
});
