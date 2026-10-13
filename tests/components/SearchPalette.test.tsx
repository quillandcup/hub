// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const searchPalette = vi.fn();
vi.mock("@/app/actions/search", () => ({ searchPalette: (q: string) => searchPalette(q) }));
vi.mock("@sentry/nextjs", () => ({ metrics: { distribution: vi.fn() } }));

import SearchPalette from "@/components/search/SearchPalette";

const results = {
  results: [
    { kind: "members", hasMore: true, hits: [{ kind: "members", id: "m1", title: "Cody Ray", subtitle: "Writes fantasy", href: "/members/m1" }] },
    { kind: "books", hasMore: false, hits: [{ kind: "books", id: "b1", title: "Codys Guide", subtitle: "Fern", date: "2026-10-01", href: "/bookshelf" }] },
  ],
};

async function openAndType(text: string) {
  const user = userEvent.setup();
  render(<SearchPalette resultsPath="/search" isAdmin={false} />);
  await user.click(screen.getByRole("button", { name: "Search" }));
  await user.type(screen.getByRole("textbox", { name: "Search" }), text);
  return user;
}

describe("SearchPalette", () => {
  beforeEach(() => {
    // jsdom doesn't implement scrolling.
    Element.prototype.scrollIntoView = vi.fn();
    push.mockReset();
    searchPalette.mockReset().mockResolvedValue(results);
    localStorage.clear();
  });

  it("groups results by kind and offers the full page", async () => {
    await openAndType("cody");
    expect(await screen.findByRole("heading", { name: "Members" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Books" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show more" })).toHaveAttribute("href", "/search?q=cody%20in%3Amembers");
    expect(screen.getByRole("link", { name: "View all results" })).toHaveAttribute("href", "/search?q=cody");
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
    expect(screen.getByRole("button", { name: /in:prickles/ })).toBeInTheDocument();
    await user.keyboard("{Tab}");
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("pizza in:prickles ");
  });

  it("clicking a chip types the operator", async () => {
    const user = userEvent.setup();
    render(<SearchPalette resultsPath="/search" isAdmin={false} />);
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(screen.getByRole("button", { name: "has:link" }));
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("has:link");
  });

  it("hides the admin-only chips from members and shows them to admins", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<SearchPalette resultsPath="/search" isAdmin={false} />);
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.queryByRole("button", { name: "email:" })).not.toBeInTheDocument();
    unmount();

    render(<SearchPalette resultsPath="/admin/search" isAdmin />);
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByRole("button", { name: "email:" })).toBeInTheDocument();
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
    await screen.findByRole("button", { name: /in:members/ });
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
});
