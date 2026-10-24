// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/dashboard" }));

const searchPalette = vi.fn();
const searchSuggestions = vi.fn();
const suggestOperatorValues = vi.fn();
const markSuggestionsRead = vi.fn();
vi.mock("@/app/actions/search", () => ({
  searchPalette: (q: string) => searchPalette(q),
  searchSuggestions: () => searchSuggestions(),
  suggestOperatorValues: (op: string, typed: string) => suggestOperatorValues(op, typed),
  markSuggestionsRead: (ids: string[]) => markSuggestionsRead(ids),
}));
vi.mock("@sentry/nextjs", () => ({ metrics: { distribution: vi.fn() } }));

import * as Sentry from "@sentry/nextjs";
import SearchPalette from "@/components/search/SearchPalette";

const results = {
  results: [
    { kind: "members", hasMore: true, hits: [{ kind: "members", id: "m1", title: "Cody Ray", subtitle: "Writes fantasy", href: "/members/m1" }] },
    { kind: "books", hasMore: false, hits: [{ kind: "books", id: "b1", title: "Codys Guide", subtitle: "Fern", date: "2026-10-01", href: "/bookshelf" }] },
  ],
};

async function open(isAdmin = false) {
  const user = userEvent.setup();
  render(<SearchPalette resultsPath={isAdmin ? "/admin/search" : "/search"} isAdmin={isAdmin} />);
  await user.click(screen.getByRole("button", { name: "Search pages, members, chat…" }));
  return user;
}

async function openAndType(text: string) {
  const user = await open();
  await user.type(screen.getByRole("textbox", { name: "Search" }), text);
  return user;
}

describe("SearchPalette", () => {
  beforeEach(() => {
    // jsdom doesn't implement scrolling.
    Element.prototype.scrollIntoView = vi.fn();
    push.mockReset();
    searchPalette.mockReset().mockResolvedValue(results);
    searchSuggestions.mockReset().mockResolvedValue({ needsAttention: [] });
    suggestOperatorValues.mockReset().mockResolvedValue([]);
    localStorage.clear();
  });

  it("groups results by kind and offers the full page", async () => {
    await openAndType("cody");
    expect(await screen.findByRole("heading", { name: "Members" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Books" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show more" })).toHaveAttribute("href", "/search?q=cody%20in%3Amembers");
    expect(screen.getByRole("link", { name: "View all results" })).toHaveAttribute("href", "/search?q=cody");
  });

  it.each([true, false])("labels round-trip timings with actual chat participation: %s", async (chatSearched) => {
    vi.mocked(Sentry.metrics.distribution).mockClear();
    searchPalette.mockResolvedValue({ results: [], chatSearched });
    await openAndType("hello");
    await waitFor(() => expect(Sentry.metrics.distribution).toHaveBeenCalledWith("search.duration", expect.any(Number), {
      unit: "millisecond",
      attributes: { surface: "palette", stage: "roundtrip", chat: chatSearched ? "included" : "excluded" },
    }));
  });

  it("Enter opens the highlighted row, and otherwise the results page", async () => {
    const user = await openAndType("cody");
    await screen.findByRole("heading", { name: "Members" });

    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(push).toHaveBeenLastCalledWith("/bookshelf");
  });

  it("goes to the results page on Enter with nothing highlighted", async () => {
    const user = await openAndType("cody");
    await screen.findByRole("heading", { name: "Members" });
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/search?q=cody");
  });

  it("completes in: with the matching kinds on Tab", async () => {
    const user = await openAndType("pizza in:pr");
    expect(screen.getByRole("button", { name: /Prickles/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Members/ })).not.toBeInTheDocument();
    await user.keyboard("{Tab}");
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("pizza in:prickles ");
  });

  it("hides the filters until the funnel is clicked, then shows the common ones as chips", async () => {
    const user = await open();
    expect(screen.queryByRole("button", { name: "From me" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show filters" }));
    expect(localStorage.getItem("hub:search-filters-on")).toBe("true");

    await user.click(screen.getByRole("button", { name: "From me" }));
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("from:me");
    expect(screen.getByRole("button", { name: "From me" })).toHaveAttribute("aria-pressed", "true");
    // A second click takes it back out.
    await user.click(screen.getByRole("button", { name: "From me" }));
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("");
  });

  it("starts a from: filter with the From… chip", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Show filters" }));
    await user.click(screen.getByRole("button", { name: "From…" }));
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("from:");
  });

  it("sets and clears a date range from the Any time dropdown, replacing a date already there", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Show filters" }));
    const range = screen.getByRole("combobox", { name: "Time range" });
    await user.selectOptions(range, "7");
    const week = (screen.getByRole("textbox", { name: "Search" }) as HTMLInputElement).value;
    expect(week).toMatch(/^after:\d{4}-\d{2}-\d{2}$/);
    expect(range).toHaveValue("7");
    await user.selectOptions(range, "30");
    const month = (screen.getByRole("textbox", { name: "Search" }) as HTMLInputElement).value;
    expect(month).toMatch(/^after:/);
    expect(month).not.toBe(week);
    await user.selectOptions(range, "");
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("");
  });

  it("keeps the rarer quick filters in +, and shows one as a chip while it is on", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Show filters" }));
    expect(screen.queryByRole("button", { name: "Threads only" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Has a link" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More filters" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: /Threads only/ }));
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("is:thread");
    await user.click(screen.getByRole("button", { name: "Threads only" }));
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("");
  });

  it("offers a kind dropdown, and the link and thread filters only while chat is in play", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Show filters" }));
    await user.click(screen.getByRole("button", { name: "More filters" }));
    expect(screen.getByRole("menuitemcheckbox", { name: /Has a link/ })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Search in" }), "members");
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("in:members");
    expect(screen.queryByRole("menuitemcheckbox", { name: /Has a link/ })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Search in" }), "");
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("");
  });

  it("adds a date from the native picker in +", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Show filters" }));
    await user.click(screen.getByRole("button", { name: "More filters" }));
    fireEvent.change(screen.getByLabelText("After date"), { target: { value: "2026-10-01" } });
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("after:2026-10-01");
  });

  it("puts the rest of the operators behind +, and the admin ones only for admins", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Show filters" }));
    await user.click(screen.getByRole("button", { name: "More filters" }));
    expect(screen.getByRole("button", { name: /From someone/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Member email/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Message has/ }));
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("has:");
  });

  it("shows the admin operators in + for admins", async () => {
    const user = await open(true);
    await user.click(screen.getByRole("button", { name: "Show filters" }));
    await user.click(screen.getByRole("button", { name: "More filters" }));
    expect(screen.getByRole("button", { name: /Member email/ })).toBeInTheDocument();
  });

  it("autocompletes from: with members, and Enter takes the highlighted one", async () => {
    suggestOperatorValues.mockResolvedValue([
      { value: "me", label: "Me" },
      { value: "Ania Ray", label: "Ania", sublabel: "Ania Ray" },
    ]);
    const user = await openAndType("from:an");
    await screen.findByRole("button", { name: /Ania/ });
    expect(suggestOperatorValues).toHaveBeenLastCalledWith("from", "an");

    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue('from:"Ania Ray" ');
  });

  it("remembers a search and lists it next time", async () => {
    const user = await openAndType("cody");
    await screen.findByRole("heading", { name: "Members" });
    await user.keyboard("{Enter}");
    await waitFor(() => expect(localStorage.getItem("hub:recent-searches")).toBe('["cody"]'));
  });

  it("shows when nothing matches", async () => {
    searchPalette.mockResolvedValue({ results: [] });
    await openAndType("zzzz");
    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument();
  });

  it("selects the previous query when reopened, so typing replaces it", async () => {
    const user = await openAndType("cody");
    await user.keyboard("{Escape}");
    await user.keyboard("{Meta>}k{/Meta}");
    const input = screen.getByRole("textbox", { name: "Search" }) as HTMLInputElement;
    expect(input).toHaveValue("cody");
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
  });

  it("waits to say a kind is unknown until in: can no longer be completed", async () => {
    searchPalette.mockResolvedValue({ results: [], unknownKind: "me" });
    await openAndType("in:me");
    await screen.findByRole("button", { name: /Members/ });
    expect(screen.queryByText(/Can’t search/)).not.toBeInTheDocument();

    searchPalette.mockResolvedValue({ results: [], unknownKind: "zzz" });
    const user = userEvent.setup();
    await user.clear(screen.getByRole("textbox", { name: "Search" }));
    await user.type(screen.getByRole("textbox", { name: "Search" }), "in:zzz");
    expect(await screen.findByText(/Can’t search/)).toBeInTheDocument();
  });

  it("offers a chat search when the palette left chat out", async () => {
    searchPalette.mockResolvedValue({ ...results, chatSkipped: true });
    await openAndType("cody");
    expect(await screen.findByRole("link", { name: /Search chat messages for/ })).toHaveAttribute("href", "/search?q=cody%20in%3Achat");
  });

  it("dims a muted result, like an archived channel", async () => {
    searchPalette.mockResolvedValue({
      results: [{ kind: "channels", hasMore: false, hits: [{ kind: "channels", id: "c1", title: "#old", badge: "archived", muted: true, href: "/chat/c1" }] }],
    });
    await openAndType("old");
    expect(await screen.findByRole("link", { name: /#old/ })).toHaveClass("opacity-60");
  });

  it("shows a visible Searching status from the keystroke until the answer arrives", async () => {
    let answer: (value: typeof results) => void = () => {};
    searchPalette.mockReset().mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await openAndType("cody");
    expect(screen.getByRole("status")).toHaveTextContent("Searching…");

    answer(results);
    await screen.findByRole("heading", { name: "Members" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows what needs attention, then recent places, when the box is empty", async () => {
    searchSuggestions.mockResolvedValue({
      needsAttention: [
        { id: "n1", kind: "checkin", title: "How was Monday Writing?", subtitle: "Prickle check-outs", href: "/prickles/p1" },
        { id: "c1", kind: "chat", title: "#general", subtitle: "Unread messages", href: "/chat/c1", count: 3 },
      ],
    });
    localStorage.setItem("hub:recent-places", JSON.stringify([{ href: "/streaks", title: "Streaks" }]));
    await open();

    const checkin = await screen.findByRole("link", { name: /How was Monday Writing/ });
    expect(checkin).toHaveAttribute("href", "/prickles/p1");
    expect(screen.getByRole("link", { name: /#general/ })).toHaveTextContent("3");
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings).toEqual(["Needs attention", "Recent places"]);
    expect(screen.getByRole("link", { name: /Streaks/ })).toHaveAttribute("href", "/streaks");
  });

  it("marks a check-out or notification read with its x, and gives chat rows none", async () => {
    markSuggestionsRead.mockResolvedValue(1);
    searchSuggestions.mockResolvedValue({
      needsAttention: [
        { id: "checkout:p1", kind: "checkin", title: "Sunday Sprint", subtitle: "Check out", href: "/my-prickles/history?checkout=p1" },
        { id: "chat:c1", kind: "chat", title: "#general", href: "/chat/c1", count: 3 },
      ],
    });
    const user = await open();
    await screen.findByRole("link", { name: /Sunday Sprint/ });
    expect(screen.getAllByRole("button", { name: /as read/ })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Mark “Sunday Sprint” as read" }));
    expect(markSuggestionsRead).toHaveBeenCalledWith(["checkout:p1"]);
    expect(screen.queryByRole("link", { name: /Sunday Sprint/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /#general/ })).toBeInTheDocument();
  });

  it("keeps recent searches behind the clock, and then they replace the suggestions", async () => {
    searchSuggestions.mockResolvedValue({ needsAttention: [{ id: "c1", kind: "chat", title: "#general", href: "/chat/c1", count: 1 }] });
    localStorage.setItem("hub:recent-searches", JSON.stringify(["cody", "fern"]));
    const user = await open();
    await screen.findByRole("link", { name: /#general/ });
    expect(screen.queryByText("Recent searches")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show search history" }));
    expect(screen.getByText("Recent searches")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "cody" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /#general/ })).not.toBeInTheDocument();
    expect(localStorage.getItem("hub:search-history-on")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Hide search history" }));
    expect(screen.queryByText("Recent searches")).not.toBeInTheDocument();
  });

  it("removes a recent search with Delete and copies one with Copy search query", async () => {
    localStorage.setItem("hub:search-history-on", "true");
    localStorage.setItem("hub:recent-searches", JSON.stringify(["cody", "fern"]));
    const user = await open();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    expect(screen.getByRole("button", { name: "Copy search query “cody”" })).toHaveAttribute("title", "Copy search query");
    await user.click(screen.getByRole("button", { name: "Copy search query “cody”" }));
    expect(writeText).toHaveBeenCalledWith("cody");

    expect(screen.getByRole("button", { name: "Delete “cody” from recent searches" })).toHaveAttribute("title", "Delete");
    await user.click(screen.getByRole("button", { name: "Delete “cody” from recent searches" }));
    expect(screen.queryByRole("button", { name: "cody" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "fern" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("hub:recent-searches")!)).toEqual(["fern"]);
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("");
  });

  it("runs a recent search when it is chosen", async () => {
    localStorage.setItem("hub:search-history-on", "true");
    localStorage.setItem("hub:recent-searches", JSON.stringify(["cody"]));
    const user = await open();
    await user.click(screen.getByRole("button", { name: "cody" }));
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("cody");
    await waitFor(() => expect(searchPalette).toHaveBeenCalledWith("cody"));
  });
});

describe("SearchPalette button name", () => {
  it("contains the text printed on the button, so voice control and screen readers agree with the screen", () => {
    render(<SearchPalette resultsPath="/search" isAdmin={false} />);
    const button = screen.getByRole("button", { name: /Search pages, members, chat/ });
    expect(button).toHaveTextContent("Search pages, members, chat…");
    expect(button).toHaveAccessibleName("Search pages, members, chat…");
    // The shortcut hint is drawn by CSS, so it is not visible text that the name would have to include.
    expect(button).not.toHaveTextContent("⌘K");
    expect(button).toHaveAttribute("aria-keyshortcuts", "Meta+K Control+K");
  });
});
