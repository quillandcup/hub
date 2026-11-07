// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import JourneyMap from "@/components/writing/JourneyMap";
import { HIRE_A_PRO_STEPS, JOURNEY_CANVAS, JOURNEY_STAGES, STAGE_HEIGHT, STAGE_WIDTH, journeyStageForPhase, stagePhases } from "@/lib/writing-journey";
import { PROJECT_PHASES } from "@/lib/writing-projects";

const stageOf = (title: string) => screen.getByRole("heading", { name: new RegExp(`^${title}$`) }).closest("li")!;
const stepOf = (title: string, nth = 0) => screen.getAllByText(title, { selector: "li > span" })[nth].closest("li")!;

describe("journeyStageForPhase", () => {
  it("places every status except hibernating at exactly one stage", () => {
    for (const phase of PROJECT_PHASES) {
      const stages = JOURNEY_STAGES.filter((s) => stagePhases(s).includes(phase));
      expect(stages).toHaveLength(phase === "hibernating" ? 0 : 1);
    }
    expect(journeyStageForPhase("beta_readers")?.id).toBe("hire-a-pro");
    expect(journeyStageForPhase("revising")?.id).toBe("hire-a-pro");
    expect(journeyStageForPhase("hibernating")).toBeNull();
  });

  it("lists the hire-a-pro steps in the order a manuscript goes through them, with a Revision after the first three", () => {
    expect(HIRE_A_PRO_STEPS.map((s) => s.title)).toEqual([
      "First read-through",
      "Developmental edit",
      "Beta readers",
      "Line & copy edit",
      "Final read-through",
      "Final beta read",
    ]);
    expect(HIRE_A_PRO_STEPS.map((s) => Boolean(s.thenRevision))).toEqual([true, true, true, false, false, false]);
  });
});

describe("JourneyMap", () => {
  it("shows each project at the stage or step its status puts it at, and paused ones apart", () => {
    render(
      <JourneyMap
        projects={[
          { id: "wprj_AAAAAAAAAAA1", title: "Book One", phase: "line_copy_edit" },
          { id: "wprj_AAAAAAAAAAA2", title: "Book Two", phase: "drafting" },
          { id: "wprj_AAAAAAAAAAA3", title: "Book Three", phase: "hibernating" },
          { id: "wprj_AAAAAAAAAAA4", title: "Book Four", phase: "complete" },
        ]}
      />
    );
    expect(within(stepOf("Line & copy edit")).getByRole("link", { name: "Book One" })).toHaveAttribute("href", "/projects/wprj_AAAAAAAAAAA1");
    expect(within(stageOf("Draft")).getByRole("link", { name: "Book Two" })).toBeInTheDocument();
    expect(within(stageOf("Publishing")).getByRole("link", { name: "Book Four" })).toBeInTheDocument();
    expect(within(stepOf("Beta readers")).queryByRole("link")).toBeNull();
    expect(screen.getByRole("heading", { name: "Paused" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book Three · Hibernating" })).toBeInTheDocument();
  });

  it("tags the stages with the statuses that put a project there", () => {
    render(<JourneyMap projects={[]} />);
    expect(stageOf("Draft")).toHaveTextContent("Status: Planning · Outlining · Drafting");
    expect(stageOf("Publishing")).toHaveTextContent("Status: Publishing · Complete");
    expect(stageOf("Launch & Sell")).toHaveTextContent("Status: Published");
    expect(stageOf("Self-Publish")).not.toHaveTextContent("Status:");
    expect(stageOf("ARC readers")).not.toHaveTextContent("Status:");
  });

  it("shows a project at the first Revision only, since the three share the status", () => {
    render(<JourneyMap projects={[{ id: "wprj_AAAAAAAAAAA1", title: "Book One", phase: "revising" }]} />);
    expect(screen.getAllByText("revise", { selector: "li > span" })).toHaveLength(3);
    expect(within(stepOf("First read-through")).getByRole("link", { name: "Book One" })).toBeInTheDocument();
    expect(within(stepOf("Developmental edit")).queryByRole("link")).toBeNull();
    expect(within(stepOf("Beta readers")).queryByRole("link")).toBeNull();
  });

  it("names The Ready Writer at Draft and gives the Self-Editing Academy every status it covers", () => {
    render(<JourneyMap projects={[]} />);
    expect(stageOf("Draft")).toHaveTextContent("The Ready Writer");
    expect(stageOf("Self-Edit")).toHaveTextContent("Self-Editing Academy");
    expect(stageOf("Self-Edit")).toHaveTextContent(
      "Status: First read-through · Revising · Developmental edit · Beta readers · Line & copy edit · Final read-through · Final beta read"
    );
  });

  it("draws the Self-Editing Academy about as big as the other programs, and the hire-a-pro path as one lane beside it", () => {
    const [draft, academy, lane] = ["draft", "self-edit", "hire-a-pro"].map((id) => JOURNEY_STAGES.find((s) => s.id === id)!);
    expect(academy.width ?? STAGE_WIDTH).toBeLessThanOrEqual((draft.width ?? STAGE_WIDTH) * 1.25);
    expect(academy.height ?? STAGE_HEIGHT).toBeLessThanOrEqual((draft.height ?? STAGE_HEIGHT) * 1.3);
    expect(lane.x).toBe(academy.x);
    expect(lane.y - lane.height! / 2).toBeGreaterThan(academy.y + academy.height! / 2);
    // The whole map stays about as tall as it is wide, instead of a row three times longer than the programs.
    expect(JOURNEY_CANVAS.width / JOURNEY_CANVAS.height).toBeLessThan(3);
    // The lane is only as tall as its six steps need.
    expect(lane.height).toBeLessThanOrEqual(210);
  });

  it("keeps ARC readers between Self-Publish and Query & Submit, inside the Publishing box", () => {
    const [pub, query, arc, box] = ["self-publish", "query-submit", "arc-readers", "publishing"].map((id) => JOURNEY_STAGES.find((s) => s.id === id)!);
    expect(pub.y + STAGE_HEIGHT / 2).toBeLessThan(arc.y - STAGE_HEIGHT / 2);
    expect(arc.y + STAGE_HEIGHT / 2).toBeLessThan(query.y - STAGE_HEIGHT / 2);
    for (const s of [pub, arc, query]) {
      expect(box.y - box.height! / 2).toBeLessThan(s.y - STAGE_HEIGHT / 2);
      expect(box.y + box.height! / 2).toBeGreaterThan(s.y + STAGE_HEIGHT / 2);
    }
  });

  it("has no Paused section when nothing is paused", () => {
    render(<JourneyMap projects={[]} />);
    expect(screen.queryByRole("heading", { name: "Paused" })).toBeNull();
  });
});
