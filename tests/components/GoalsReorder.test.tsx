// @vitest-environment jsdom
/**
 * A member puts the goals of a project in their own order on the project page: a grip on each goal (drag it, or Space
 * and the arrow keys) and a "Move to position" menu. jsdom has no layout or real touch, so the drag itself is driven
 * through the `onDragEnd` the list hands to dnd-kit, and the menu is clicked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DndContextProps } from "@dnd-kit/core";
import { HANDLE_TOOLTIP } from "@/components/writing/SortableList";
import ProjectDetailClient from "@/app/(member)/projects/[id]/ProjectDetailClient";
import type { GoalRow, WritingProjectRow } from "@/app/(member)/projects/actions";
import { tooltipText } from "@/tests/helpers/tooltip";

const m = vi.hoisted(() => ({ refresh: vi.fn(), reorder: vi.fn(), dnd: { current: null as null | DndContextProps } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: m.refresh }) }));
vi.mock("@/app/(member)/bookshelf/actions", () => ({ deleteBook: vi.fn() }));
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
  reorderMyGoals: m.reorder,
}));
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: DndContextProps) => {
      m.dnd.current = props;
      return <actual.DndContext {...props} />;
    },
  };
});
vi.mock("@/components/writing/GoalDisplay", () => ({ default: ({ goal }: { goal: GoalRow }) => <p>{goal.title}</p> }));
vi.mock("@/components/writing/ProjectCharts", () => ({ default: () => null }));
vi.mock("@/components/writing/ProjectDetailsModal", () => ({ default: () => null }));
vi.mock("@/components/writing/LogProgressModal", () => ({ default: () => null }));
vi.mock("@/components/books/BookFormModal", () => ({ default: () => null }));

const goal = (id: string, title: string, status: "active" | "ended" = "active"): GoalRow =>
  ({
    id, projectId: "wprj_1", measure: "words", isStarred: false, title, description: null, showOnProfile: false, kind: "target", targetAmount: 1000, startDate: null,
    endDate: status === "ended" ? "2026-03-13" : null, current: 700, percent: 70, includesStartingBalance: false, excludedStartingBalance: null, projectTotal: 700, parTarget: null, onPace: null, status,
  }) as unknown as GoalRow;

const project = (goals: GoalRow[]) =>
  ({ id: "wprj_1", title: "Lantern Draft Two", phase: "drafting", createdAt: "2026-01-01T00:00:00Z", showOnProfile: false, coverUrl: null, description: null, startingBalances: {}, totalsByMeasure: {}, goals, book: null }) as unknown as WritingProjectRow;

const three = () => [goal("g1", "Daily words"), goal("g2", "Finish draft"), goal("g3", "Read aloud")];
const titles = () => [...document.querySelectorAll("[data-sortable-row]")].map((row) => within(row as HTMLElement).getByText(/Daily words|Finish draft|Read aloud/).textContent);

beforeEach(() => {
  m.refresh.mockReset();
  m.reorder.mockReset().mockResolvedValue({ success: true });
});
afterEach(cleanup);

describe("ProjectDetailClient goal reordering", () => {
  async function openMenu(title: string) {
    await userEvent.click(screen.getByRole("button", { name: `More actions for ${title}` }));
  }

  it("lists the goals in the order it is given, each with a drag handle and a tooltip", () => {
    render(<ProjectDetailClient project={project(three())} entries={[]} archivedGoals={[]} />);
    expect(titles()).toEqual(["Daily words", "Finish draft", "Read aloud"]);
    expect(screen.getAllByRole("button", { name: /^Reorder / })).toHaveLength(3);
    for (const handle of screen.getAllByRole("button", { name: /^Reorder / })) expect(tooltipText(handle)).toBe(HANDLE_TOOLTIP);
    expect(screen.queryByRole("button", { name: /^Move .* (up|down)$/ })).toBeNull();
  });

  it("uses the same grip handle as the projects list", () => {
    render(<ProjectDetailClient project={project(three())} entries={[]} archivedGoals={[]} />);
    for (const handle of screen.getAllByRole("button", { name: /^Reorder / })) {
      expect(handle.querySelector("svg.lucide-equal")).not.toBeNull();
      expect(handle.querySelector("svg.lucide-grip-vertical")).toBeNull();
      expect(handle.querySelector("svg")!.getAttribute("class")).toMatch(/\bh-5 w-5\b/);
      expect(handle.className).not.toMatch(/(^|\s)(dark:)?bg-|h-11|w-11/);
    }
    // The tip is the shared Tooltip: it shows on keyboard focus (hover and the rest: tests/components/Tooltip.test.tsx).
    const handle = screen.getAllByRole("button", { name: /^Reorder / })[0];
    expect(tooltipText(handle)).toBe(HANDLE_TOOLTIP);
  });

  it("carries Edit, Delete and the positions in one menu, with Edit and Delete only on narrow screens", async () => {
    render(<ProjectDetailClient project={project(three())} entries={[]} archivedGoals={[]} />);
    await openMenu("Finish draft");
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Edit", "Delete", "Move to position 1", "Position 2 (current)", "Move to position 3"]);
    expect(screen.getByRole("menuitem", { name: "Edit" }).className).toMatch(/\bsm:hidden\b/);
    expect(screen.getByRole("menuitem", { name: "Delete" }).className).toMatch(/\bsm:hidden\b/);
    expect(screen.getAllByRole("button", { name: "More actions for Finish draft" })).toHaveLength(1);
  });

  it("Delete in the menu asks first, then deletes that goal", async () => {
    const { deleteGoal } = await import("@/app/(member)/projects/actions");
    vi.mocked(deleteGoal).mockResolvedValue({ success: true } as never);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ProjectDetailClient project={project(three())} entries={[]} archivedGoals={[]} />);
    await openMenu("Finish draft");
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(deleteGoal).toHaveBeenCalledWith("g2"));
    expect(window.confirm).toHaveBeenCalledWith("Delete this goal? This can't be undone.");
  });

  it("Edit in the menu opens the goal form", async () => {
    render(<ProjectDetailClient project={project(three())} entries={[]} archivedGoals={[]} />);
    await openMenu("Finish draft");
    await userEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(screen.queryByRole("button", { name: "More actions for Finish draft" })).toBeNull();
  });

  it("has no ordering controls for a single goal", () => {
    render(<ProjectDetailClient project={project([goal("g1", "Daily words")])} entries={[]} archivedGoals={[]} />);
    expect(screen.queryByRole("button", { name: /^Reorder / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^More actions for / })).toBeNull();
  });

  it("leaves a missed goal out of the order, in Past goals", () => {
    render(<ProjectDetailClient project={project([...three(), goal("g4", "Missed one", "ended")])} entries={[]} archivedGoals={[]} />);
    expect(screen.getAllByRole("button", { name: /^Reorder / })).toHaveLength(3);
  });

  it("shows the current position in the menu and moves a goal to the chosen one, saving the project's order and announcing it", async () => {
    render(<ProjectDetailClient project={project(three())} entries={[]} archivedGoals={[]} />);
    await openMenu("Daily words");
    expect(screen.getByRole("menuitem", { name: "Position 1 (current)" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByRole("menuitem", { name: "Move to position 2" }));
    expect(titles()).toEqual(["Finish draft", "Daily words", "Read aloud"]);
    expect(m.reorder).toHaveBeenCalledWith("wprj_1", ["g2", "g1", "g3"]);
    await waitFor(() => expect(m.refresh).toHaveBeenCalledOnce());
    expect(screen.getByText("Daily words moved to position 2 of 3.")).toBeInTheDocument();
  });

  it("saves the order a drag ended in, and ignores a drop where it started", async () => {
    render(<ProjectDetailClient project={project(three())} entries={[]} archivedGoals={[]} />);
    const end = m.dnd.current!.onDragEnd!;
    end({ active: { id: "g1" }, over: { id: "g1" } } as never);
    expect(m.reorder).not.toHaveBeenCalled();
    end({ active: { id: "g3" }, over: { id: "g1" } } as never);
    await waitFor(() => expect(m.reorder).toHaveBeenCalledWith("wprj_1", ["g3", "g1", "g2"]));
  });

  it("puts the list back and says so when the save is refused", async () => {
    m.reorder.mockResolvedValue({ error: "Failed to save the order" });
    render(<ProjectDetailClient project={project(three())} entries={[]} archivedGoals={[]} />);
    await openMenu("Read aloud");
    await userEvent.click(screen.getByRole("menuitem", { name: "Move to position 2" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the new order");
    expect(titles()).toEqual(["Daily words", "Finish draft", "Read aloud"]);
    expect(m.refresh).not.toHaveBeenCalled();
  });
});
