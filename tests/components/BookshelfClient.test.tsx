// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookshelfClient, { type ShelfBook } from "@/app/(member)/bookshelf/BookshelfClient";

function book(id: string, genres: string[]): ShelfBook {
  return {
    id,
    memberId: "mbr_AAAAAAAAAAA1",
    memberName: "Ada Example",
    title: `Title ${id}`,
    description: null,
    coverUrl: "https://example.com/c.jpg",
    purchaseUrl: "https://example.com/b",
    publishedDate: "2026-03-15",
    price: null,
    genres,
    format: "print",
  };
}

const SHELF = [book("one", ["Romance", "Fantasy"]), book("two", ["fantasy"]), book("three", []), book("four", ["Cozy Mystery"])];

afterEach(cleanup);

describe("BookshelfClient genre filter", () => {
  it("lists each genre once with its count, case-insensitively, most common first", () => {
    render(<BookshelfClient shelf={SHELF} />);
    const chips = screen.getAllByRole("button").map((b) => b.textContent);
    expect(chips).toEqual(["All", "Fantasy (2)", "Cozy Mystery (1)", "Romance (1)"]);
  });

  it("shows only books with the chosen genre, and all again on All or a second click", async () => {
    render(<BookshelfClient shelf={SHELF} />);
    expect(screen.getByText("The Shelf (4)")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Fantasy (2)" }));
    expect(screen.getByText("The Shelf (2)")).toBeInTheDocument();
    expect(screen.getByText("Title one")).toBeInTheDocument();
    expect(screen.getByText("Title two")).toBeInTheDocument();
    expect(screen.queryByText("Title three")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Fantasy (2)" }));
    expect(screen.getByText("The Shelf (4)")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cozy Mystery (1)" }));
    expect(screen.getByText("The Shelf (1)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("The Shelf (4)")).toBeInTheDocument();
  });

  it("shows no filter when no book has a genre", () => {
    render(<BookshelfClient shelf={[book("three", [])]} />);
    expect(screen.queryByRole("group", { name: "Filter by genre" })).not.toBeInTheDocument();
  });
});
