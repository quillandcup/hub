import type { ProjectPhase } from "@/lib/writing-projects";

/**
 * Journey: the stages a book goes through at Quill & Cup and the offer at each. A project's position is derived from its status, never stored. `hibernating`
 * is not a position: it pauses or ends a project at any stage.
 */
export type JourneyOffer = "live" | "external" | "roadmap" | "own";

/** One step of the hire-a-pro lane, which lists the editing steps compactly instead of drawing a box for each. */
export interface JourneyStep {
  title: string;
  /** own: the writer's own work; external: hired outside Quill & Cup; roadmap: planned feedback from readers. */
  offerStatus: JourneyOffer;
  /** Statuses that put a project at this step. A step with none is only on the map (the later Revisions share the first one's status). */
  phases: ProjectPhase[];
  /** A Revision that follows this step, drawn as a small tag on its line instead of a line of its own. It has its own statuses (the later ones share the first one's, so they have none). */
  thenRevision?: { phases: ProjectPhase[] };
}

export interface JourneyStage {
  id: string;
  /** The label on the diagram ("01", "02A"). */
  step: string;
  title: string;
  /** The Quill & Cup program or course at this stage, or who to hire. */
  offer: string;
  description: string;
  /** live: ours today; external: hired outside Quill & Cup; roadmap: planned; own: the writer's own work. */
  offerStatus: JourneyOffer;
  /** Statuses that put a project at this stage. A stage with none is only on the map. The Publishing box holds Complete beside Publishing until Complete and Published are sorted out. */
  phases: ProjectPhase[];
  /** Centre of the stage on the diagram's canvas (JOURNEY_CANVAS). */
  x: number;
  y: number;
  /** Overrides STAGE_WIDTH / STAGE_HEIGHT (the hire-a-pro lane and the Publishing box are taller). */
  width?: number;
  height?: number;
  /** "group": a box around stages (Publishing). "lane": the hire-a-pro steps, listed inside one box (`steps`). */
  kind?: "group" | "lane";
  /** The statuses a program covers, for its Status line, when projects sit at the steps of another stage (the Self-Editing Academy). */
  coversPhases?: ProjectPhase[];
  steps?: JourneyStep[];
}

/** The diagram's size; stages are placed by their centre and are STAGE_WIDTH x STAGE_HEIGHT. */
export const JOURNEY_CANVAS = { width: 1400, height: 580 };
export const STAGE_WIDTH = 206;
export const STAGE_HEIGHT = 120;

/** The editing steps between a finished draft and publishing, done with hired professionals (and beta readers) instead of the Academy. */
export const HIRE_A_PRO_STEPS: JourneyStep[] = [
  { title: "First read-through", offerStatus: "own", phases: ["first_read_through"], thenRevision: { phases: ["revising"] } },
  { title: "Developmental edit", offerStatus: "external", phases: ["developmental_edit"], thenRevision: { phases: [] } },
  { title: "Beta readers", offerStatus: "roadmap", phases: ["beta_readers"], thenRevision: { phases: [] } },
  { title: "Line & copy edit", offerStatus: "external", phases: ["line_copy_edit"] },
  { title: "Final read-through", offerStatus: "own", phases: ["final_read_through"] },
  { title: "Final beta read", offerStatus: "roadmap", phases: ["final_beta_read"] },
];

export const JOURNEY_STAGES: JourneyStage[] = [
  {
    id: "draft",
    step: "01",
    title: "Draft",
    offer: "The Ready Writer",
    description: "Daily sprints and weekly prompts, from a spark to a finished manuscript.",
    offerStatus: "live",
    phases: ["planning", "outlining", "drafting"],
    x: 280,
    y: 250,
  },
  {
    id: "self-edit",
    step: "02A",
    title: "Self-Edit",
    offer: "Self-Editing Academy",
    description: "The DIY route, start to finish.",
    offerStatus: "live",
    phases: [],
    coversPhases: ["first_read_through", "revising", "developmental_edit", "beta_readers", "line_copy_edit", "final_read_through", "final_beta_read"],
    x: 620,
    y: 165,
    width: 230,
    height: 150,
  },
  {
    id: "hire-a-pro",
    step: "02B",
    title: "Or hire your own pros",
    offer: "Hired independently",
    description: "",
    offerStatus: "external",
    phases: [],
    kind: "lane",
    steps: HIRE_A_PRO_STEPS,
    x: 620,
    y: 410,
    width: 230,
    height: 200,
  },
  {
    id: "publishing",
    step: "03",
    title: "Publishing",
    offer: "Self-publish or query",
    description: "",
    offerStatus: "roadmap",
    phases: ["publishing", "complete"],
    kind: "group",
    x: 960,
    y: 290,
    width: 290,
    height: 500,
  },
  {
    id: "self-publish",
    step: "03A",
    title: "Self-Publish",
    offer: "Self-Publishing course",
    description: "Formatting, covers and launch mechanics.",
    offerStatus: "roadmap",
    phases: [],
    x: 960,
    y: 140,
  },
  {
    id: "arc-readers",
    step: "",
    title: "ARC readers",
    offer: "Build buzz",
    description: "Early copies, with feedback folding back in.",
    offerStatus: "roadmap",
    phases: [],
    x: 960,
    y: 290,
  },
  {
    id: "query-submit",
    step: "03B",
    title: "Query & Submit",
    offer: "Trad Publishing course",
    description: "Query letters, comp titles and agent research.",
    offerStatus: "roadmap",
    phases: [],
    x: 960,
    y: 440,
  },
  {
    id: "launch",
    step: "04",
    title: "Launch & Sell",
    offer: "Marketing",
    description: "The shelf, the storefront, and the next spark.",
    offerStatus: "roadmap",
    phases: ["published"],
    x: 1270,
    y: 290,
  },
];

/** BFF (Best Feedback Friends) supports Draft and Self-Edit; it isn't a stage a project is at. */
export const JOURNEY_BFF = { title: "BFF", subtitle: "Best Feedback Friends", description: "Critique partners trading chapters through Draft and Self-Edit.", x: 300, y: 66, width: 190, height: 90 };

/** Every status that puts a project at the stage, directly or at one of its steps. */
export function stagePhases(stage: JourneyStage): ProjectPhase[] {
  return [...stage.phases, ...(stage.steps ?? []).flatMap((s) => [...s.phases, ...(s.thenRevision?.phases ?? [])])];
}

/** The stage a project in `phase` is at, or null when the status isn't a position (hibernating). */
export function journeyStageForPhase(phase: string): JourneyStage | null {
  return JOURNEY_STAGES.find((s) => (stagePhases(s) as string[]).includes(phase)) ?? null;
}

export const JOURNEY_OFFER_LABELS: Record<JourneyOffer, string> = {
  live: "Live",
  external: "Hire a pro",
  roadmap: "Roadmap",
  own: "You",
};
