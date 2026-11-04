// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import JourneyMap from "@/components/writing/JourneyMap";
import { JOURNEY_STAGES, STAGE_HEIGHT, STAGE_WIDTH, journeyStageForPhase } from "@/lib/writing-journey";
import { PROJECT_PHASES } from "@/lib/writing-projects";

const stageOf = (title: string) => screen.getByRole("heading", { name: new RegExp(`^${title}$`) }).closest("li")!;

describe("journeyStageForPhase", () => {
  it("places every status except on hold and hibernating at exactly one stage", () => {
    for (const phase of PROJECT_PHASES) {
      const stages = JOURNEY_STAGES.filter((s) => s.phases.includes(phase));
      expect(stages).toHaveLength(phase === "on_hold" || phase === "hibernating" ? 0 : 1);
    }
    expect(journeyStageForPhase("beta_readers")?.title).toBe("Beta readers");
    expect(journeyStageForPhase("revising")?.id).toBe("revision-1");
    expect(journeyStageForPhase("on_hold")).toBeNull();
  });

  it("walks the hire-a-pro row in the order a manuscript goes through it", () => {
    const row = JOURNEY_STAGES.filter((s) => s.y === 400).sort((a, b) => a.x - b.x);
    expect(row.map((s) => s.title)).toEqual([
      "First read-through",
      "Revision",
      "Developmental edit",
      "Revision",
      "Beta readers",
      "Revision",
      "Line & copy edit",
      "Final read-through",
      "Final beta read",
    ]);
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
          { id: "wprj_AAAAAAAAAAA4", title: "Book Four", phase: "complete" },
        ]}
      />
    );
    expect(within(stageOf("Line & copy edit")).getByRole("link", { name: "Book One" })).toHaveAttribute("href", "/projects/wprj_AAAAAAAAAAA1");
    expect(within(stageOf("Draft")).getByRole("link", { name: "Book Two" })).toBeInTheDocument();
    expect(within(stageOf("Publishing")).getByRole("link", { name: "Book Four" })).toBeInTheDocument();
    expect(within(stageOf("Beta readers")).queryByRole("link")).toBeNull();
    expect(screen.getByRole("heading", { name: "Paused" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book Three · On hold" })).toBeInTheDocument();
  });

  it("tags each stage with the statuses that put a project there", () => {
    render(<JourneyMap projects={[]} />);
    expect(stageOf("Draft")).toHaveTextContent("Status: Planning · Outlining · Drafting");
    expect(stageOf("First read-through")).toHaveTextContent("Status: First read-through");
    expect(stageOf("Developmental edit")).toHaveTextContent("Status: Developmental edit");
    expect(stageOf("Beta readers")).toHaveTextContent("Status: Beta readers");
    expect(stageOf("Line & copy edit")).toHaveTextContent("Status: Line & copy edit");
    expect(stageOf("Final read-through")).toHaveTextContent("Status: Final read-through");
    expect(stageOf("Final beta read")).toHaveTextContent("Status: Final beta read");
    expect(stageOf("Publishing")).toHaveTextContent("Status: Publishing · Complete");
    expect(stageOf("Launch & Sell")).toHaveTextContent("Status: Published");
    expect(stageOf("Self-Publish")).not.toHaveTextContent("Status:");
    expect(stageOf("ARC readers")).not.toHaveTextContent("Status:");
  });

  it("shows a project at the first Revision only, since the other two share its status", () => {
    render(<JourneyMap projects={[{ id: "wprj_AAAAAAAAAAA1", title: "Book One", phase: "revising" }]} />);
    const revisions = screen.getAllByRole("heading", { name: "Revision" }).map((h) => h.closest("li")!);
    expect(revisions).toHaveLength(3);
    expect(within(revisions[0]).getByRole("link", { name: "Book One" })).toBeInTheDocument();
    expect(within(revisions[1]).queryByRole("link")).toBeNull();
    expect(within(revisions[2]).queryByRole("link")).toBeNull();
  });

  it("names The Ready Writer at Draft and spans the Self-Editing Academy over every stage of the row, with every status it covers", () => {
    render(<JourneyMap projects={[]} />);
    expect(stageOf("Draft")).toHaveTextContent("The Ready Writer");
    const academy = JOURNEY_STAGES.find((s) => s.offer === "Self-Editing Academy")!;
    const row = JOURNEY_STAGES.filter((s) => s.y === 400);
    for (const stage of row) {
      expect(academy.x - academy.width! / 2).toBeLessThanOrEqual(stage.x - STAGE_WIDTH / 2);
      expect(academy.x + academy.width! / 2).toBeGreaterThanOrEqual(stage.x + STAGE_WIDTH / 2);
    }
    expect(academy.y + academy.height! / 2).toBeLessThan(400 - STAGE_HEIGHT / 2);
    expect(stageOf("Self-Edit")).toHaveTextContent(
      "Status: First read-through · Revising · Developmental edit · Beta readers · Line & copy edit · Final read-through · Final beta read"
    );
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
