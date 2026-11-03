import type { ProjectPhase } from "@/lib/writing-projects";

/**
 * Journey: the stages a book goes through at Quill & Cup and the offer at each. A project's position is derived from its status, never stored. `on_hold`
 * and `hibernating` are not positions: they pause or end a project at any stage.
 */
export type JourneyOffer = "live" | "external" | "roadmap";

export interface JourneyStage {
  id: string;
  /** The label on the diagram ("01", "02A"). */
  step: string;
  title: string;
  /** The Quill & Cup program or course at this stage, or who to hire. */
  offer: string;
  description: string;
  /** live: ours today; external: hired outside Quill & Cup; roadmap: planned. */
  offerStatus: JourneyOffer;
  /** Statuses that put a project at this stage. A stage with none is only on the map (the publishing fork). */
  phases: ProjectPhase[];
  /** Centre of the stage on the diagram's canvas (JOURNEY_CANVAS). */
  x: number;
  y: number;
  /** Overrides STAGE_WIDTH / STAGE_HEIGHT for a stage drawn as a bar over others (the Self-Editing Academy). */
  width?: number;
  height?: number;
}

/** The diagram's size; stages are placed by their centre and are STAGE_WIDTH x STAGE_HEIGHT. */
export const JOURNEY_CANVAS = { width: 2400, height: 540 };
export const STAGE_WIDTH = 206;
export const STAGE_HEIGHT = 120;

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
    description: "The DIY route: one course that takes you through the developmental edit, both rounds of beta readers and the line & copy edit.",
    offerStatus: "live",
    phases: ["revising"],
    x: 980,
    y: 232,
    width: 1046,
    height: 96,
  },
  {
    id: "developmental-edit",
    step: "02B",
    title: "Developmental edit",
    offer: "Hired independently",
    description: "Or pay a professional to reshape structure and story.",
    offerStatus: "external",
    phases: ["developmental_edit"],
    x: 560,
    y: 360,
  },
  {
    id: "beta-readers",
    step: "03",
    title: "Beta readers",
    offer: "Get feedback",
    description: "The revised manuscript in front of real readers.",
    offerStatus: "roadmap",
    phases: ["beta_readers"],
    x: 840,
    y: 360,
  },
  {
    id: "line-copy-edit",
    step: "04",
    title: "Line & copy edit",
    offer: "Hired independently",
    description: "Sharpen the voice, then polish the prose.",
    offerStatus: "external",
    phases: ["line_copy_edit"],
    x: 1120,
    y: 360,
  },
  {
    id: "final-beta-read",
    step: "05",
    title: "Final beta read",
    offer: "Get feedback",
    description: "A final check with fresh readers before you publish.",
    offerStatus: "roadmap",
    phases: ["final_beta_read"],
    x: 1400,
    y: 360,
  },
  {
    id: "self-publish",
    step: "06A",
    title: "Self-Publish",
    offer: "Self-Publishing course",
    description: "Formatting, covers and launch mechanics.",
    offerStatus: "roadmap",
    phases: [],
    x: 1680,
    y: 105,
  },
  {
    id: "query-submit",
    step: "06B",
    title: "Query & Submit",
    offer: "Trad Publishing course",
    description: "Query letters, comp titles and agent research.",
    offerStatus: "roadmap",
    phases: [],
    x: 1680,
    y: 395,
  },
  {
    id: "arc-readers",
    step: "",
    title: "ARC readers",
    offer: "Build buzz",
    description: "Early copies, with feedback folding back in.",
    offerStatus: "roadmap",
    phases: ["complete"],
    x: 1960,
    y: 250,
  },
  {
    id: "launch",
    step: "07",
    title: "Launch & Sell",
    offer: "Marketing",
    description: "The shelf, the storefront, and the next spark.",
    offerStatus: "roadmap",
    phases: ["published"],
    x: 2240,
    y: 250,
  },
];

/** BFF (Best Feedback Friends) supports Draft and Self-Edit; it isn't a stage a project is at. */
export const JOURNEY_BFF = { title: "BFF", subtitle: "Best Feedback Friends", description: "Critique partners trading chapters through Draft and Self-Edit.", x: 300, y: 66, width: 190, height: 90 };

/** The stage a project in `phase` is at, or null when the status isn't a position (on hold, hibernating). */
export function journeyStageForPhase(phase: string): JourneyStage | null {
  return JOURNEY_STAGES.find((s) => (s.phases as string[]).includes(phase)) ?? null;
}

export const JOURNEY_OFFER_LABELS: Record<JourneyOffer, string> = {
  live: "Live",
  external: "Hire a pro",
  roadmap: "Roadmap",
};
