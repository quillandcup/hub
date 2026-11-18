// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ProjectDetailClient from "@/app/(member)/projects/[id]/ProjectDetailClient";
import type { WritingProjectRow } from "@/app/(member)/projects/actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(member)/bookshelf/actions", () => ({ deleteBook: vi.fn(), addBook: vi.fn(), updateBook: vi.fn() }));
vi.mock("@/app/(member)/projects/actions", () => ({
  archiveGoal: vi.fn(),
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
  phase: "planning",
  createdAt: "2026-01-01T00:00:00Z",
  showOnProfile: true,
  coverUrl: null,
  description: null,
  startingBalances: {},
  totalsByMeasure: {},
  goals: [],
  book: null,
} as unknown as WritingProjectRow;

describe("the project page's header row", () => {
  // The visibility toggle, the status, Edit details and Export CSV are too wide for one line on a phone: the row wraps
  // instead of running off the right edge, and no label breaks in the middle of a phrase.
  it("wraps, at both levels, and keeps each label on one line", () => {
    render(<ProjectDetailClient project={project} entries={[]} archivedGoals={[]} />);
    const exportLink = screen.getByRole("link", { name: /Export CSV/ });
    const editButton = screen.getByRole("button", { name: /Edit details/ });
    expect(exportLink.parentElement).toHaveClass("flex-wrap");
    expect(editButton.parentElement).toHaveClass("flex-wrap");
    expect(exportLink).toHaveClass("whitespace-nowrap");
    expect(editButton).toHaveClass("whitespace-nowrap");
    expect(screen.getByText("On my profile")).toHaveClass("whitespace-nowrap");
  });
});
