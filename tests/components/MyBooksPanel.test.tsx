// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MyBooksPanel from "@/app/(member)/projects/MyBooksPanel";
import type { MyBookRow } from "@/app/(member)/bookshelf/actions";
import { tooltipText } from "@/tests/helpers/tooltip";

const { refresh, deleteBook, setBookVisibility } = vi.hoisted(() => ({
  refresh: vi.fn(),
  deleteBook: vi.fn(),
  setBookVisibility: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

vi.mock("@/app/(member)/bookshelf/actions", () => ({
  deleteBook,
  setBookVisibility,
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
    publishedDate: "2025-06-15",
    editions: [{ format: "ebook", purchaseUrl: "https://example.com/buy", price: 4.99 }],
    genres: [],
    projectId: null,
    visibility: "public",
    webAuthor: "Ada E.",
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
      'Remove "The Lantern Keeper" from the Book Shelf? "Lantern Draft Two" will no longer be marked as published.'
    );
  });

  it("uses the plain confirm message for a standalone book (or one with an unknown project)", async () => {
    const user = userEvent.setup();
    render(<MyBooksPanel initialBooks={[STANDALONE, UNKNOWN_PROJECT]} projectTitles={PROJECT_TITLES} />);

    await user.click(within(rowFor("Salt and Starlight")).getByRole("button", { name: "Remove" }));
    expect(confirmSpy).toHaveBeenLastCalledWith('Remove "Salt and Starlight" from the Book Shelf?');

    await user.click(within(rowFor("Moss Letters")).getByRole("button", { name: "Remove" }));
    expect(confirmSpy).toHaveBeenLastCalledWith('Remove "Moss Letters" from the Book Shelf?');
  });

  it("does not delete when the member cancels the confirm", async () => {
    const user = userEvent.setup();
    render(<MyBooksPanel initialBooks={[LINKED]} projectTitles={PROJECT_TITLES} />);

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(deleteBook).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  describe("who can see a book", () => {
    const control = (title: string) => within(rowFor(title)).getByRole("button", { name: /Who can see this book/ });

    it("shows each book's level on a lock, house or globe control with its own words in the tooltip", () => {
      render(
        <MyBooksPanel
          initialBooks={[book({ id: "a", title: "Private One", visibility: "private" }), book({ id: "b", title: "House One", visibility: "community" }), book({ id: "c", title: "Globe One", visibility: "public" })]}
          projectTitles={{}}
        />,
      );
      expect(control("Private One")).toHaveAccessibleName("Who can see this book: Only me");
      expect(control("House One")).toHaveAccessibleName("Who can see this book: Other members");
      expect(control("Globe One")).toHaveAccessibleName("Who can see this book: Everyone");
      expect(control("Private One").querySelector("svg.lucide-lock")).not.toBeNull();
      expect(tooltipText(control("Globe One"))).toBe("Anyone can see this book on the web, on the public Hedgie Bookshelf. Click to hide it from everyone but you.");
      expect(tooltipText(control("Private One"))).toBe("Only you can see this book. Click to show it to other members only.");
      // No browser tooltip on the control.
      expect(control("Globe One")).not.toHaveAttribute("title");
    });

    it("saves the next level on a click, shows it at once and refreshes", async () => {
      setBookVisibility.mockResolvedValue({ success: true });
      const user = userEvent.setup();
      render(<MyBooksPanel initialBooks={[book({ id: "b-solo", title: "Salt and Starlight", visibility: "public" })]} projectTitles={{}} />);
      await user.click(control("Salt and Starlight"));
      expect(setBookVisibility).toHaveBeenCalledWith("b-solo", "private");
      expect(control("Salt and Starlight")).toHaveAccessibleName("Who can see this book: Only me");
      expect(refresh).toHaveBeenCalled();
    });

    it("puts the level back and says why when it could not be saved", async () => {
      setBookVisibility.mockResolvedValue({ error: "Only the member can change who sees their book." });
      const user = userEvent.setup();
      render(<MyBooksPanel initialBooks={[book({ id: "b-solo", title: "Salt and Starlight", visibility: "community" })]} projectTitles={{}} />);
      await user.click(control("Salt and Starlight"));
      expect(await screen.findByRole("alert")).toHaveTextContent("Only the member can change who sees their book.");
      expect(control("Salt and Starlight")).toHaveAccessibleName("Who can see this book: Other members");
      expect(refresh).not.toHaveBeenCalled();
    });

    it("tells a member that a book at the globe with no name on it shows no author, and only then", () => {
      render(
        <MyBooksPanel
          initialBooks={[
            book({ id: "a", title: "Nameless Globe", visibility: "public", webAuthor: null }),
            book({ id: "b", title: "Nameless Private", visibility: "private", webAuthor: null }),
            book({ id: "c", title: "Named Globe", visibility: "public", webAuthor: "Ada E." }),
          ]}
          projectTitles={{}}
        />,
      );
      expect(within(rowFor("Nameless Globe")).getByTestId("book-no-web-author")).toHaveTextContent("sees this book with no author name");
      expect(within(rowFor("Nameless Private")).queryByTestId("book-no-web-author")).not.toBeInTheDocument();
      expect(within(rowFor("Named Globe")).queryByTestId("book-no-web-author")).not.toBeInTheDocument();
    });
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
