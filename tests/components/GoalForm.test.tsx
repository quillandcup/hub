// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { createGoal, updateGoal } = vi.hoisted(() => ({
  createGoal: vi.fn(async (_input: unknown) => ({ success: true })),
  updateGoal: vi.fn(async (_id: string, _input: unknown) => ({ success: true })),
}));
vi.mock("@/app/(member)/projects/actions", () => ({
  createGoal,
  updateGoal,
  archiveGoal: vi.fn(),
  deleteEntry: vi.fn(),
  deleteGoal: vi.fn(),
  toggleGoalStar: vi.fn(),
  toggleGoalVisibility: vi.fn(),
  toggleProjectVisibility: vi.fn(),
  updateProjectPhase: vi.fn(),
}));
vi.mock("@/app/(member)/bookshelf/actions", () => ({ deleteBook: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { GoalForm } from "@/app/(member)/projects/[id]/ProjectDetailClient";
import { GOAL_EXAMPLES, MEASURE_LABELS, WRITING_MEASURES } from "@/lib/writing-projects";

beforeEach(() => vi.clearAllMocks());

const pinned = () => screen.getByRole("checkbox", { name: /Pin to my dashboard/ });
const onProfile = () => screen.getByRole("checkbox", { name: /Show on my profile/ });
const amount = () => screen.getByLabelText("Target amount") as HTMLInputElement;

describe("GoalForm", () => {
  it("explains the two kinds of goal", async () => {
    render(<GoalForm projectId="p1" onSaved={vi.fn()} />);
    expect(screen.getByText(/A total to reach/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Habit" }));
    expect(screen.getByText(/A rhythm to keep/)).toBeInTheDocument();
    expect(screen.queryByText(/A total to reach/)).not.toBeInTheDocument();
  });

  it("pins a new goal to the dashboard and shows it on the profile, and saves both", async () => {
    render(<GoalForm projectId="p1" onSaved={vi.fn()} />);
    expect(pinned()).toBeChecked();
    expect(onProfile()).toBeChecked();

    await userEvent.type(amount(), "20");
    await userEvent.click(screen.getByRole("button", { name: "Add goal" }));
    expect(createGoal).toHaveBeenCalledWith(expect.objectContaining({ isStarred: true, showOnProfile: true }));
  });

  it("lets the member untick either for a new goal", async () => {
    render(<GoalForm projectId="p1" onSaved={vi.fn()} />);
    await userEvent.click(pinned());
    await userEvent.click(onProfile());
    expect(pinned()).not.toBeChecked();
    expect(onProfile()).not.toBeChecked();
  });

  it("keeps what an existing goal saved, rather than the new-goal defaults", () => {
    const goal = {
      id: "g1",
      kind: "target",
      measure: "words",
      targetAmount: 1000,
      startDate: null,
      endDate: null,
      title: null,
      description: null,
      showOnProfile: false,
      isStarred: false,
    };
    render(<GoalForm projectId="p1" goal={goal as never} onSaved={vi.fn()} />);
    expect(pinned()).not.toBeChecked();
    expect(onProfile()).not.toBeChecked();
  });

  it("gives an example amount that fits the chosen measure", async () => {
    render(<GoalForm projectId="p1" onSaved={vi.fn()} />);
    // Prickles attended is the default, so 50,000 would read oddly.
    expect(amount().placeholder).toBe(`e.g. ${GOAL_EXAMPLES.target.prickles}`);
    expect(amount().placeholder).not.toContain("50000");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Measure" }), "words");
    expect(amount().placeholder).toBe("e.g. 50000");
  });

  it("has an example for every measure, for both kinds of goal", () => {
    for (const kind of ["target", "habit"] as const) {
      for (const measure of WRITING_MEASURES) {
        expect(GOAL_EXAMPLES[kind][measure], `${kind} ${MEASURE_LABELS[measure]}`).toMatch(/^\d+$/);
      }
    }
  });

  it("gives a habit threshold example that fits the measure too", async () => {
    render(<GoalForm projectId="p1" onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Habit" }));
    const threshold = screen.getByLabelText(/Threshold per period/) as HTMLInputElement;
    expect(threshold.placeholder).toBe(`e.g. ${GOAL_EXAMPLES.habit.prickles}`);
  });
});
