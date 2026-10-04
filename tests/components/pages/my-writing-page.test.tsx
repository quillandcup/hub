// @vitest-environment jsdom
/**
 * Page wiring for My Writing (app/(member)/projects/ProjectsPage.tsx): the Projects/Books/Awards
 * tabs and their routes (/projects, /projects/books, /projects/awards; legacy ?tab= redirects), and
 * the data each panel receives. MyBooksPanel renders for real (its own behavior
 * is covered in MyBooksPanel.test.tsx); the Projects and Awards panels are stubbed to show what they
 * were given.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import {
  ADMIN_USER,
  MEMBER_IDENTITY,
  MEMBER_USER,
  expectRedirect,
  renderServerRoute,
  resetServerPageMocks,
  signInAs,
} from "@/tests/helpers/server-page";
import type { MyBookRow } from "@/app/(member)/bookshelf/actions";
import type { WritingProjectRow } from "@/app/(member)/projects/actions";
import type { MyAwardRow } from "@/app/(member)/awards/actions";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));

vi.mock("@/app/(member)/projects/actions", () => ({ getMyProjects: vi.fn(), publishProject: vi.fn() }));
vi.mock("@/app/(member)/bookshelf/actions", () => ({
  getMyBooks: vi.fn(),
  addBook: vi.fn(),
  updateBook: vi.fn(),
  deleteBook: vi.fn(),
}));
vi.mock("@/app/(member)/awards/actions", () => ({ getMyAwards: vi.fn() }));

vi.mock("@/app/(member)/projects/ProjectsClient", () => ({
  default: ({ initialProjects }: { initialProjects: WritingProjectRow[] }) => (
    <div data-testid="projects-client">{initialProjects.map((p) => p.title).join(", ")}</div>
  ),
}));
vi.mock("@/app/(member)/projects/MyAwardsPanel", () => ({
  default: ({ initialAwards, myBooks }: { initialAwards: MyAwardRow[]; myBooks: MyBookRow[] }) => (
    <div data-testid="awards-panel">
      awards: {initialAwards.map((a) => a.awardName).join(", ")}; books: {myBooks.length}
    </div>
  ),
}));

import MyWritingIndex from "@/app/(member)/projects/page";
import BooksRoute from "@/app/(member)/projects/books/page";
import AwardsRoute from "@/app/(member)/projects/awards/page";
import ProjectsPage from "@/app/(member)/projects/ProjectsPage";
import { getMyProjects } from "@/app/(member)/projects/actions";
import { getMyBooks } from "@/app/(member)/bookshelf/actions";
import { getMyAwards } from "@/app/(member)/awards/actions";

const PROJECTS = [
  { id: "proj-lantern", title: "Lantern Draft Two" },
  { id: "proj-tide", title: "Tidepool Stories" },
] as WritingProjectRow[];

function book(overrides: Partial<MyBookRow>): MyBookRow {
  return {
    id: "book",
    title: "Untitled",
    description: null,
    coverUrl: null,
    purchaseUrl: null,
    publishedDate: "2025-06-15",
    price: null,
    genre: null,
    format: "ebook",
    projectId: null,
    ...overrides,
  } as MyBookRow;
}

const BOOKS = [
  book({ id: "book-lantern", title: "The Lantern Keeper", projectId: "proj-lantern" }),
  book({ id: "book-solo", title: "Salt and Starlight" }),
];

const AWARDS = [{ id: "award-1", awardName: "Golden Quill" }] as MyAwardRow[];

const props = (tab?: string) => ({ params: Promise.resolve({}), searchParams: Promise.resolve(tab ? { tab } : {}) });

beforeEach(() => {
  resetServerPageMocks();
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  vi.mocked(getMyProjects).mockResolvedValue(PROJECTS);
  vi.mocked(getMyBooks).mockResolvedValue(BOOKS);
  vi.mocked(getMyAwards).mockResolvedValue(AWARDS);
});

describe("My Writing page", () => {
  it("renders the heading and Projects/Books/Awards tabs, defaulting to Projects", async () => {
    await renderServerRoute(MyWritingIndex, props());
    expect(screen.getByRole("heading", { level: 1, name: "My Writing" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Projects", "Books", "Awards"]);
    expect(screen.getByRole("tab", { name: "Projects" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("tabpanel")).getByTestId("projects-client")).toHaveTextContent(
      "Lantern Draft Two, Tidepool Stories"
    );
  });

  it("falls back to Projects for an unknown ?tab=", async () => {
    await renderServerRoute(MyWritingIndex, props("bogus"));
    expect(screen.getByRole("tab", { name: "Projects" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("projects-client")).toBeInTheDocument();
  });

  it("redirects a legacy ?tab= link to the tab's path", async () => {
    await expectRedirect(MyWritingIndex, props("books"), "/projects/books");
    await expectRedirect(MyWritingIndex, props("projects"), "/projects");
  });

  it("/projects/books passes all books with project titles to MyBooksPanel", async () => {
    await renderServerRoute(BooksRoute, undefined as never);
    expect(screen.getByRole("tab", { name: "Books" })).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("The Lantern Keeper")).toBeInTheDocument();
    expect(within(panel).getByText("Salt and Starlight")).toBeInTheDocument();
    const lanternRow = within(panel).getByText("The Lantern Keeper").closest("li") as HTMLElement;
    expect(lanternRow).toHaveTextContent("From Lantern Draft Two");
    expect(within(lanternRow).getByRole("link", { name: "Lantern Draft Two" })).toHaveAttribute(
      "href",
      "/projects/proj-lantern"
    );
    const soloRow = within(panel).getByText("Salt and Starlight").closest("li") as HTMLElement;
    expect(soloRow).not.toHaveTextContent("From");
  });

  it("/projects/awards passes awards plus the member's books to MyAwardsPanel", async () => {
    await renderServerRoute(AwardsRoute, undefined as never);
    expect(screen.getByRole("tab", { name: "Awards" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("tabpanel")).getByTestId("awards-panel")).toHaveTextContent(
      "awards: Golden Quill; books: 2"
    );
  });

  it("redirects a user with no effective member identity to /admin", async () => {
    signInAs(ADMIN_USER, null);
    await expectRedirect(ProjectsPage, { tab: "projects" }, "/admin");
  });
});
