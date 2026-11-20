// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as actions from "@/app/(member)/projects/actions";
import ProjectDetailClient from "@/app/(member)/projects/[id]/ProjectDetailClient";
import ProjectsClient from "@/app/(member)/projects/ProjectsClient";
import type { GoalRow, WritingProjectRow } from "@/app/(member)/projects/actions";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/app/(member)/bookshelf/actions", () => ({ deleteBook: vi.fn(), addBook: vi.fn(), updateBook: vi.fn() }));
vi.mock("@/app/(member)/projects/actions", () => ({
  archiveGoal: vi.fn(),
  createGoal: vi.fn(),
  deleteEntry: vi.fn(),
  deleteGoal: vi.fn(),
  toggleGoalStar: vi.fn(),
  setGoalVisibility: vi.fn(),
  setProjectVisibility: vi.fn(),
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
    visibility: "private",
    kind: "target",
    targetAmount: 1000,
    startDate: null,
    endDate: "2026-03-13",
    current: 700,
    percent: 70,
    includesStartingBalance: false,
    excludedStartingBalance: null,
    projectTotal: 700,
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
  visibility: "private" as const,
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
    refresh.mockReset();
    alertSpy.mockReset();
    vi.mocked(actions.toggleGoalStar).mockResolvedValue({ success: true } as never);
    vi.mocked(actions.setGoalVisibility).mockResolvedValue({ success: true } as never);
    vi.mocked(actions.deleteGoal).mockResolvedValue({ success: true } as never);
    vi.mocked(actions.archiveGoal).mockResolvedValue({ success: true } as never);
    Object.defineProperty(window, "location", { value: { ...window.location, reload }, writable: true });
    vi.stubGlobal("alert", alertSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  function renderMissedOnly() {
    render(<ProjectDetailClient project={{ ...project, goals: [goals[2]] }} entries={[]} archivedGoals={[]} />);
  }

  it("pins a missed goal and refreshes in place, or alerts when the action fails", async () => {
    renderMissedOnly();
    await userEvent.click(screen.getByRole("button", { name: "Pin to my dashboard" }));
    expect(actions.toggleGoalStar).toHaveBeenCalledWith("g3", true);
    expect(refresh).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    refresh.mockReset();
    vi.mocked(actions.toggleGoalStar).mockResolvedValueOnce({ error: "Could not pin" } as never);
    await userEvent.click(screen.getByRole("button", { name: "Pin to my dashboard" }));
    expect(alertSpy).toHaveBeenCalledWith("Could not pin");
    expect(refresh).not.toHaveBeenCalled();
  });

  const levels = () => screen.getAllByRole("button", { name: /^Who can see this/ });

  it("moves a missed goal one level up and refreshes in place, or alerts when the action fails", async () => {
    // The project's own control comes first; the goal row's is the last one. The project is community, so the goal can go up to it.
    render(<ProjectDetailClient project={{ ...project, visibility: "community", showOnProfile: true, goals: [goals[2]] }} entries={[]} archivedGoals={[]} />);
    const goalControl = () => levels().at(-1)!;
    expect(goalControl()).toHaveAccessibleName("Who can see this goal: Only me");
    await userEvent.click(goalControl());
    expect(actions.setGoalVisibility).toHaveBeenCalledWith("g3", "community");
    expect(refresh).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    vi.mocked(actions.setGoalVisibility).mockResolvedValueOnce({ error: "Could not change" } as never);
    await userEvent.click(goalControl());
    expect(alertSpy).toHaveBeenCalledWith("Could not change");
  });

  it("cycles a project private, community, public and back, and does not refresh", async () => {
    vi.mocked(actions.setProjectVisibility).mockReset().mockResolvedValue({ success: true } as never);
    renderMissedOnly();
    const projectControl = () => levels()[0];
    expect(projectControl()).toHaveAccessibleName("Who can see this project: Only me");
    for (const [from, to] of [["Only me", "Other members"], ["Other members", "Everyone"], ["Everyone", "Only me"]]) {
      expect(projectControl()).toHaveAccessibleName(`Who can see this project: ${from}`);
      await userEvent.click(projectControl());
      await waitFor(() => expect(projectControl()).toHaveAccessibleName(`Who can see this project: ${to}`));
    }
    expect(actions.setProjectVisibility).toHaveBeenNthCalledWith(1, "wpr_AAAAAAAAAAA1", "community");
    expect(actions.setProjectVisibility).toHaveBeenNthCalledWith(2, "wpr_AAAAAAAAAAA1", "public");
    expect(actions.setProjectVisibility).toHaveBeenNthCalledWith(3, "wpr_AAAAAAAAAAA1", "private");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps a goal's own level when its project goes private, shows it as private meanwhile, and brings it back with the project", async () => {
    vi.mocked(actions.setProjectVisibility).mockReset().mockResolvedValue({ success: true } as never);
    vi.mocked(actions.setGoalVisibility).mockClear();
    const shownGoal = { ...goals[2], showOnProfile: true, visibility: "community" as const };
    render(<ProjectDetailClient project={{ ...project, visibility: "community", showOnProfile: true, goals: [shownGoal] }} entries={[]} archivedGoals={[]} />);
    expect(levels()[1]).toHaveAccessibleName("Who can see this goal: Other members");

    // community -> public -> private: the project goes private and the goal reads as private too.
    await userEvent.click(levels()[0]);
    await waitFor(() => expect(levels()[0]).toHaveAccessibleName("Who can see this project: Everyone"));
    expect(levels()[1]).toHaveAccessibleName("Who can see this goal: Other members");
    await userEvent.click(levels()[0]);
    await waitFor(() => expect(levels()[0]).toHaveAccessibleName("Who can see this project: Only me"));
    expect(levels()[1]).toHaveAccessibleName("Who can see this goal: Only me");
    await userEvent.click(levels()[0]);
    await waitFor(() => expect(levels()[0]).toHaveAccessibleName("Who can see this project: Other members"));
    expect(levels()[1]).toHaveAccessibleName("Who can see this goal: Other members");
    expect(actions.setGoalVisibility).not.toHaveBeenCalled();
  });

  it("reads a goal that is more visible than its project as the project's level, and a click goes up from there", async () => {
    vi.mocked(actions.setGoalVisibility).mockClear();
    render(<ProjectDetailClient project={{ ...project, goals: [{ ...goals[2], showOnProfile: true, visibility: "public" }] }} entries={[]} archivedGoals={[]} />);
    expect(levels().at(-1)).toHaveAccessibleName("Who can see this goal: Only me");
    await userEvent.click(levels().at(-1)!);
    expect(actions.setGoalVisibility).toHaveBeenCalledWith("g3", "community");
  });

  it("starts a new goal on the profile when its project is on the profile, and off when it is not", async () => {
    const { unmount } = render(<ProjectDetailClient project={{ ...project, showOnProfile: true, visibility: "community", goals: [] }} entries={[]} archivedGoals={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "+ Add a goal" }));
    expect(screen.getByRole("checkbox", { name: /Show on my profile/ })).toBeChecked();
    unmount();
    render(<ProjectDetailClient project={{ ...project, goals: [] }} entries={[]} archivedGoals={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "+ Add a goal" }));
    expect(screen.getByRole("checkbox", { name: /Show on my profile/ })).not.toBeChecked();
  });

  it("closes the new goal form with its Cancel button", async () => {
    render(<ProjectDetailClient project={{ ...project, goals: [] }} entries={[]} archivedGoals={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "+ Add a goal" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Cancel" }).at(-1)!);
    expect(screen.queryByRole("button", { name: "Add goal" })).not.toBeInTheDocument();
  });

  it("deletes a missed goal once confirmed", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    renderMissedOnly();
    await userEvent.click(screen.getByRole("button", { name: "Delete goal" }));
    expect(actions.deleteGoal).toHaveBeenCalledWith("g3");
    expect(refresh).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("opens a missed goal for editing, and Cancel closes it", async () => {
    renderMissedOnly();
    await userEvent.click(screen.getByRole("button", { name: "Edit goal" }));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.getByText("Missed goal")).toBeInTheDocument();
  });

  it("saves an edited missed goal and refreshes in place", async () => {
    vi.mocked(actions.updateGoal).mockResolvedValue({ success: true } as never);
    renderMissedOnly();
    await userEvent.click(screen.getByRole("button", { name: "Edit goal" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(actions.updateGoal).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("marks a missed goal as done from its edit form", async () => {
    renderMissedOnly();
    await userEvent.click(screen.getByRole("button", { name: "Edit goal" }));
    await userEvent.click(screen.getByRole("button", { name: /Mark as done/ }));
    expect(actions.archiveGoal).toHaveBeenCalledWith("g3");
    expect(refresh).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
