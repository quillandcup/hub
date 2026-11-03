// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import JourneyMap from "@/components/writing/JourneyMap";
import { JOURNEY_STAGES, journeyStageForPhase } from "@/lib/writing-journey";
import { PROJECT_PHASES } from "@/lib/writing-projects";

describe("journeyStageForPhase", () => {
  it("places every status except on hold and hibernating at exactly one stage", () => {
    for (const phase of PROJECT_PHASES) {
      const stages = JOURNEY_STAGES.filter((s) => s.phases.includes(phase));
      expect(stages).toHaveLength(phase === "on_hold" || phase === "hibernating" ? 0 : 1);
    }
    expect(journeyStageForPhase("beta_readers")?.title).toBe("Beta readers");
    expect(journeyStageForPhase("on_hold")).toBeNull();
  });
});

describe("JourneyMap", () => {
  it("shows each project under the stage its status puts it at, and paused ones apart", () => {
    render(
      <JourneyMap
        projects={[
          { id: "wprj_AAAAAAAAAAA1", title: "Book One", phase: "line_copy_edit" },
          { id: "wprj_AAAAAAAAAAA2", title: "Book Two", phase: "drafting" },
          { id: "wprj_AAAAAAAAAAA3", title: "Book Three", phase: "on_hold" },
        ]}
      />
    );
    const stage = (title: string) => screen.getByRole("heading", { name: new RegExp(title) }).closest("li")!;
    expect(within(stage("Line & copy edit")).getByRole("link", { name: "Book One" })).toHaveAttribute("href", "/projects/wprj_AAAAAAAAAAA1");
    expect(within(stage("Draft")).getByRole("link", { name: "Book Two" })).toBeInTheDocument();
    expect(within(stage("Beta readers")).queryByRole("link")).toBeNull();
    expect(screen.getByRole("heading", { name: "Paused" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book Three · On hold" })).toBeInTheDocument();
  });

  it("tags each stage with the statuses that put a project there", () => {
    render(<JourneyMap projects={[]} />);
    const stage = (title: string) => screen.getByRole("heading", { name: new RegExp(title) }).closest("li")!;
    expect(stage("Draft")).toHaveTextContent("Status: Planning · Outlining · Drafting");
    expect(stage("Self-Edit")).toHaveTextContent("Status: Revising");
    expect(stage("Developmental edit")).toHaveTextContent("Status: Developmental edit");
    expect(stage("Beta readers")).toHaveTextContent("Status: Beta readers");
    expect(stage("Final beta read")).toHaveTextContent("Status: Final beta read");
    expect(stage("Line & copy edit")).toHaveTextContent("Status: Line & copy edit");
    expect(stage("ARC readers")).toHaveTextContent("Status: Complete");
    expect(stage("Launch")).toHaveTextContent("Status: Published");
    expect(stage("Self-Publish")).not.toHaveTextContent("Status:");
  });

  it("names The Ready Writer at Draft and spans the Self-Editing Academy over the edit and beta stages", () => {
    render(<JourneyMap projects={[]} />);
    const stage = (title: string) => screen.getByRole("heading", { name: new RegExp(title) }).closest("li")!;
    expect(stage("Draft")).toHaveTextContent("The Ready Writer");
    const academy = JOURNEY_STAGES.find((s) => s.offer === "Self-Editing Academy")!;
    const [first, last] = [JOURNEY_STAGES.find((s) => s.id === "developmental-edit")!, JOURNEY_STAGES.find((s) => s.id === "final-beta-read")!];
    expect(academy.x - academy.width! / 2).toBeLessThanOrEqual(first.x);
    expect(academy.x + academy.width! / 2).toBeGreaterThanOrEqual(last.x);
    expect(academy.y).toBeLessThan(first.y);
  });

  it("has no Paused section when nothing is paused", () => {
    render(<JourneyMap projects={[]} />);
    expect(screen.queryByRole("heading", { name: "Paused" })).toBeNull();
  });
});
