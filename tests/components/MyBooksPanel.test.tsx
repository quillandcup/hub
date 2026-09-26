// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MyBooksPanel from "@/app/(member)/projects/MyBooksPanel";
import type { MyBookRow } from "@/app/(member)/bookshelf/actions";

const { refresh, deleteBook } = vi.hoisted(() => ({
  refresh: vi.fn(),
  deleteBook: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

vi.mock("@/app/(member)/bookshelf/actions", () => ({
  deleteBook,
  addBook: vi.fn(),
  updateBook: vi.fn(),
}));

vi.mock("@/app/(member)/projects/actions", () => ({
  publishProject: vi.fn(),
}));

function book(overrides: Partial<MyBookRow>): MyBookRow {
  return {
    id: "b1",
    title: "Untitled",
    description: null,
    coverUrl: "https://example.com/cover.png",
    purchaseUrl: "https://example.com/buy",
    publishedDate: "2025-06-15",
    price: 4.99,
    genre: null,
    format: "ebook",
    projectId: null,
    ...overrides,
  } as MyBookRow;
}

const LINKED = book({ id: "b-linked", title: "The Lantern Keeper", projectId: "proj-1" });
const STANDALONE = book({ id: "b-solo", title: "Salt and Starlight" });
const UNKNOWN_PROJECT = book({ id: "b-orphan", title: "Moss Letters", projectId: "proj-gone" });
const PROJECT_TITLES = { "proj-1": "Lantern Draft Two" };

function rowFor(title: string): HTMLElement {
  return screen.getByText(title).closest("li") as HTMLElement;
}

describe("MyBooksPanel", () => {
  let confirmSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);
    vi.stubGlobal("alert", vi.fn());
    deleteBook.mockReset();
    refresh.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the empty state when the member has no books", () => {
    render(<MyBooksPanel initialBooks={[]} projectTitles={{}} />);
    expect(
      screen.getByText("No books yet -- publishing a project adds one automatically, or add one by hand.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("renders every book, linking a project-published book back to its project", () => {
    render(<MyBooksPanel initialBooks={[LINKED, STANDALONE, UNKNOWN_PROJECT]} projectTitles={PROJECT_TITLES} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);

    const linkedRow = rowFor("The Lantern Keeper");
    const link = within(linkedRow).getByRole("link", { name: "Lantern Draft Two" });
    expect(link).toHaveAttribute("href", "/projects/proj-1");
    expect(linkedRow).toHaveTextContent("· From Lantern Draft Two");

    // No project link for a standalone book, or one whose project title isn't known.
    expect(within(rowFor("Salt and Starlight")).queryByRole("link")).not.toBeInTheDocument();
    expect(within(rowFor("Salt and Starlight")).queryByText(/From/)).not.toBeInTheDocument();
    expect(within(rowFor("Moss Letters")).queryByRole("link")).not.toBeInTheDocument();
  });

  it("warns that removing a project-linked book unmarks the project as published", async () => {
    const user = userEvent.setup();
    render(<MyBooksPanel initialBooks={[LINKED, STANDALONE]} projectTitles={PROJECT_TITLES} />);

    await user.click(within(rowFor("The Lantern Keeper")).getByRole("button", { name: "Remove" }));
    expect(confirmSpy).toHaveBeenCalledWith(
      'Remove "The Lantern Keeper" from the Bookshelf? "Lantern Draft Two" will no longer be marked as published.'
    );
  });

  it("uses the plain confirm message for a standalone book (or one with an unknown project)", async () => {
    const user = userEvent.setup();
    render(<MyBooksPanel initialBooks={[STANDALONE, UNKNOWN_PROJECT]} projectTitles={PROJECT_TITLES} />);

    await user.click(within(rowFor("Salt and Starlight")).getByRole("button", { name: "Remove" }));
    expect(confirmSpy).toHaveBeenLastCalledWith('Remove "Salt and Starlight" from the Bookshelf?');

    await user.click(within(rowFor("Moss Letters")).getByRole("button", { name: "Remove" }));
    expect(confirmSpy).toHaveBeenLastCalledWith('Remove "Moss Letters" from the Bookshelf?');
  });

  it("does not delete when the member cancels the confirm", async () => {
    const user = userEvent.setup();
    render(<MyBooksPanel initialBooks={[LINKED]} projectTitles={PROJECT_TITLES} />);

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(deleteBook).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("deletes the book and refreshes when the member confirms", async () => {
    confirmSpy.mockReturnValue(true);
    deleteBook.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<MyBooksPanel initialBooks={[LINKED]} projectTitles={PROJECT_TITLES} />);

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(deleteBook).toHaveBeenCalledWith("b-linked");
    expect(refresh).toHaveBeenCalled();
  });
});
