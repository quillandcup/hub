// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProjectDetailClient from "@/app/(member)/projects/[id]/ProjectDetailClient";
import type { WritingProjectRow } from "@/app/(member)/projects/actions";

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
  archiveGoal: vi.fn(),
  archiveProject: vi.fn(),
  restoreProject: vi.fn(),
  deleteProject: vi.fn(),
  createGoal: vi.fn(),
  deleteEntry: vi.fn(),
  deleteGoal: vi.fn(),
  toggleGoalStar: vi.fn(),
  toggleGoalVisibility: vi.fn(),
  toggleProjectVisibility: vi.fn(),
  updateGoal: vi.fn(),
  updateProjectPhase: vi.fn(),
}));

vi.mock("@/components/writing/LogProgressModal", () => ({ default: () => null }));
vi.mock("@/components/writing/GoalDisplay", () => ({ default: () => null }));
vi.mock("@/components/writing/ProjectCharts", () => ({ default: () => null }));
vi.mock("@/components/writing/ProjectDetailsModal", () => ({ default: () => null }));
vi.mock("@/components/books/BookFormModal", () => ({ default: () => null }));

const project = {
  id: "wpr_AAAAAAAAAAA1",
  title: "Lantern Draft Two",
  phase: "published",
  createdAt: "2026-01-01T00:00:00Z",
  showOnProfile: false,
  coverUrl: null,
  description: null,
  startingBalances: {},
  totalsByMeasure: {},
  goals: [],
  book: {
    id: "b1",
    title: "The Lantern Keeper",
    description: null,
    coverUrl: "https://example.com/cover.png",
    purchaseUrl: "https://example.com/buy",
    publishedDate: "2025-06-15",
    price: 4.99,
    genres: [],
    format: "ebook",
    projectId: "wpr_AAAAAAAAAAA1",
  },
} as unknown as WritingProjectRow;

describe("ProjectDetailClient published book", () => {
  beforeEach(() => {
    deleteBook.mockReset();
    deleteBook.mockResolvedValue({ success: true });
    refresh.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("links to the Book Shelf page", () => {
    render(<ProjectDetailClient project={project} entries={[]} archivedGoals={[]} />);
    expect(screen.getByRole("link", { name: "View on the Book Shelf" })).toHaveAttribute("href", "/bookshelf");
  });

  it("asks before removing the book from the Book Shelf", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ProjectDetailClient project={project} entries={[]} archivedGoals={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(confirmSpy).toHaveBeenCalledWith('Remove "The Lantern Keeper" from the Book Shelf?');
    expect(deleteBook).not.toHaveBeenCalled();
  });

  it("removes the book once confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ProjectDetailClient project={project} entries={[]} archivedGoals={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(deleteBook).toHaveBeenCalledWith("b1");
  });
});
