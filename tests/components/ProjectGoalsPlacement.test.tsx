// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as actions from "@/app/(member)/projects/actions";
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

describe("goal row controls on the project page", () => {
  const reload = vi.fn();
  const alertSpy = vi.fn();

  beforeEach(() => {
    reload.mockReset();
    alertSpy.mockReset();
    vi.mocked(actions.toggleGoalStar).mockResolvedValue({ success: true } as never);
    vi.mocked(actions.toggleGoalVisibility).mockResolvedValue({ success: true } as never);
    vi.mocked(actions.deleteGoal).mockResolvedValue({ success: true } as never);
    vi.mocked(actions.archiveGoal).mockResolvedValue({ success: true } as never);
    Object.defineProperty(window, "location", { value: { ...window.location, reload }, writable: true });
    vi.stubGlobal("alert", alertSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  function renderMissedOnly() {
    render(<ProjectDetailClient project={{ ...project, goals: [goals[2]] }} entries={[]} archivedGoals={[]} />);
  }

  it("pins a missed goal and reloads, or alerts when the action fails", async () => {
    renderMissedOnly();
    await userEvent.click(screen.getByRole("button", { name: "Pin to my dashboard" }));
    expect(actions.toggleGoalStar).toHaveBeenCalledWith("g3", true);
    expect(reload).toHaveBeenCalled();

    reload.mockReset();
    vi.mocked(actions.toggleGoalStar).mockResolvedValueOnce({ error: "Could not pin" } as never);
    await userEvent.click(screen.getByRole("button", { name: "Pin to my dashboard" }));
    expect(alertSpy).toHaveBeenCalledWith("Could not pin");
    expect(reload).not.toHaveBeenCalled();
  });

  it("shows a missed goal on the profile and reloads, or alerts when the action fails", async () => {
    renderMissedOnly();
    // The page's own project-level toggle comes first; the goal row's is the last one.
    const goalToggle = () => screen.getAllByRole("button", { name: "Show on my profile" }).at(-1)!;
    await userEvent.click(goalToggle());
    expect(actions.toggleGoalVisibility).toHaveBeenCalledWith("g3", true);
    expect(reload).toHaveBeenCalled();

    vi.mocked(actions.toggleGoalVisibility).mockResolvedValueOnce({ error: "Could not change" } as never);
    await userEvent.click(goalToggle());
    expect(alertSpy).toHaveBeenCalledWith("Could not change");
  });

  it("deletes a missed goal once confirmed", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    renderMissedOnly();
    await userEvent.click(screen.getByRole("button", { name: "Delete goal" }));
    expect(actions.deleteGoal).toHaveBeenCalledWith("g3");
    expect(reload).toHaveBeenCalled();
  });

  it("opens a missed goal for editing, and Cancel closes it", async () => {
    renderMissedOnly();
    await userEvent.click(screen.getByRole("button", { name: "Edit goal" }));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.getByText("Missed goal")).toBeInTheDocument();
  });

  it("saves an edited missed goal and reloads", async () => {
    vi.mocked(actions.updateGoal).mockResolvedValue({ success: true } as never);
    renderMissedOnly();
    await userEvent.click(screen.getByRole("button", { name: "Edit goal" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(actions.updateGoal).toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
  });

  it("marks a missed goal as done from its edit form", async () => {
    renderMissedOnly();
    await userEvent.click(screen.getByRole("button", { name: "Edit goal" }));
    await userEvent.click(screen.getByRole("button", { name: /Mark as done/ }));
    expect(actions.archiveGoal).toHaveBeenCalledWith("g3");
    expect(reload).toHaveBeenCalled();
  });
});
