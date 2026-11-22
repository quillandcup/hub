// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import MilestoneStrip from "@/components/member/MilestoneStrip";
import { ANOTHER_WORK_TITLE } from "@/lib/finishers";
import type { ShownWorkStep } from "@/lib/data/milestones";

const step = (overrides: Partial<ShownWorkStep> = {}): ShownWorkStep => ({
  workNo: 1,
  kind: "the_end",
  workTitle: "A Fake Novel",
  achievedOn: null,
  achievedPrecision: "day",
  storyBefore: null,
  storyAfter: null,
  visibility: "public",
  ...overrides,
});

describe("MilestoneStrip: naming a work", () => {
  it("names each work the reader gave a title for, so several in a row are told apart", () => {
    render(<MilestoneStrip steps={[step({ workNo: 1, workTitle: "First Fake Work" }), step({ workNo: 2, workTitle: "Second Fake Work" })]} />);
    const works = screen.getAllByTestId("milestone-work");
    expect(works.map((w) => within(w).getByRole("heading").textContent)).toEqual(["First Fake Work", "Second Fake Work"]);
  });

  it("calls a work the viewer may not see by name 'Another work', and never shows a blank heading", () => {
    render(<MilestoneStrip steps={[step({ workNo: 1, workTitle: null }), step({ workNo: 2, workTitle: null })]} />);
    const works = screen.getAllByTestId("milestone-work");
    expect(works).toHaveLength(2);
    for (const w of works) expect(within(w).getByRole("heading")).toHaveTextContent(ANOTHER_WORK_TITLE);
    expect(ANOTHER_WORK_TITLE).toBe("Another work");
  });

  it("takes the name from whichever row of the work has one", () => {
    render(<MilestoneStrip steps={[step({ workTitle: null }), step({ kind: "published", workTitle: "A Fake Novel" })]} />);
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("A Fake Novel");
  });

  it("draws nothing when there is nothing to show", () => {
    render(<MilestoneStrip steps={[]} />);
    expect(screen.queryByTestId("milestone-strip")).not.toBeInTheDocument();
  });
});
