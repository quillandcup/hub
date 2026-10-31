// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ProjectDetailClient from "@/app/(member)/projects/[id]/ProjectDetailClient";
import ProjectsClient from "@/app/(member)/projects/ProjectsClient";
import type { GoalRow, WritingProjectRow } from "@/app/(member)/projects/actions";

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
vi.mock("@/components/writing/GoalDisplay", () => ({ default: ({ goal }: { goal: GoalRow }) => <p>{goal.title}</p> }));
vi.mock("@/components/writing/LogProgressModal", () => ({ default: () => null }));
vi.mock("@/components/writing/NewProjectModal", () => ({ default: () => null }));
vi.mock("@/components/writing/TrackbearImportModal", () => ({ default: () => null }));
vi.mock("@/components/writing/ProjectCharts", () => ({ default: () => null }));
vi.mock("@/components/writing/ProjectDetailsModal", () => ({ default: () => null }));
vi.mock("@/components/books/BookFormModal", () => ({ default: () => null }));
vi.mock("@/app/(member)/projects/PastProjects", () => ({ default: () => null }));

function targetGoal(id: string, title: string, status: "active" | "achieved" | "ended"): GoalRow {
  return {
    id,
    projectId: "wpr_AAAAAAAAAAA1",
    measure: "words",
    isStarred: false,
    title,
    description: null,
    showOnProfile: false,
    kind: "target",
    targetAmount: 1000,
    startDate: null,
    endDate: "2026-03-13",
    current: 700,
    percent: 70,
    parTarget: null,
    onPace: null,
    status,
  };
}

const goals = [
  targetGoal("g1", "Active goal", "active"),
  targetGoal("g2", "Reached goal", "achieved"),
  targetGoal("g3", "Missed goal", "ended"),
];

const project = {
  id: "wpr_AAAAAAAAAAA1",
  title: "Lantern Draft Two",
  phase: "drafting",
  createdAt: "2026-01-01T00:00:00Z",
  showOnProfile: false,
  coverUrl: null,
  description: null,
  startingBalances: {},
  totalsByMeasure: {},
  goals,
  book: null,
} as unknown as WritingProjectRow;

describe("where a goal that ended unmet shows", () => {
  it("is left off the project list, while active and achieved goals stay", () => {
    render(<ProjectsClient initialProjects={[project]} />);
    expect(screen.getByText("Active goal")).toBeInTheDocument();
    expect(screen.getByText("Reached goal")).toBeInTheDocument();
    expect(screen.queryByText("Missed goal")).not.toBeInTheDocument();
  });

  it("shows no goals block on the list when every goal was missed", () => {
    render(<ProjectsClient initialProjects={[{ ...project, goals: [goals[2]] }]} />);
    expect(screen.queryByText("Missed goal")).not.toBeInTheDocument();
  });

  it("moves to Past goals on the project page, still editable", () => {
    render(<ProjectDetailClient project={project} entries={[]} archivedGoals={[]} />);
    const pastHeading = screen.getByRole("heading", { name: "Past goals" });
    const goalsHeading = screen.getByRole("heading", { name: "Goals" });
    const missed = screen.getByText("Missed goal");
    // Document order: Goals (active, achieved), then Past goals (missed).
    expect(goalsHeading.compareDocumentPosition(screen.getByText("Active goal")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pastHeading.compareDocumentPosition(missed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(goalsHeading.compareDocumentPosition(missed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Edit goal" })).toHaveLength(3);
  });

  it("shows no Goals section when every goal was missed", () => {
    render(<ProjectDetailClient project={{ ...project, goals: [goals[2]] }} entries={[]} archivedGoals={[]} />);
    expect(screen.queryByRole("heading", { name: "Goals" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Past goals" })).toBeInTheDocument();
  });
});
