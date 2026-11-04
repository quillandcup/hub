import type { ProjectPhase } from "@/lib/writing-projects";

/**
 * Journey: the stages a book goes through at Quill & Cup and the offer at each. A project's position is derived from its status, never stored. `on_hold`
 * and `hibernating` are not positions: they pause or end a project at any stage.
 */
export type JourneyOffer = "live" | "external" | "roadmap" | "own";

export interface JourneyStage {
  id: string;
  /** The label on the diagram ("01", "02A"). */
  step: string;
  title: string;
  /** The Quill & Cup program or course at this stage, who to hire, or "On your own". */
  offer: string;
  description: string;
  /** live: ours today; external: hired outside Quill & Cup; roadmap: planned; own: the writer's own work. */
  offerStatus: JourneyOffer;
  /** Statuses that put a project at this stage. A stage with none is only on the map. The Publishing box holds Complete beside Publishing until Complete and Published are sorted out. */
  phases: ProjectPhase[];
  /** Centre of the stage on the diagram's canvas (JOURNEY_CANVAS). */
  x: number;
  y: number;
  /** Overrides STAGE_WIDTH / STAGE_HEIGHT for a stage drawn over others (a bar or a box). */
  width?: number;
  height?: number;
  /** "bar": a program that runs across several stages (the Self-Editing Academy); "group": a box around stages (Publishing). Neither places projects. */
  kind?: "bar" | "group";
  /** The statuses a bar covers, for its Status line (projects sit at the stages themselves). */
  coversPhases?: ProjectPhase[];
}

/** The diagram's size; stages are placed by their centre and are STAGE_WIDTH x STAGE_HEIGHT. */
export const JOURNEY_CANVAS = { width: 3500, height: 580 };
export const STAGE_WIDTH = 206;
export const STAGE_HEIGHT = 120;

/** The hire-a-pro swimlane, left to right: x of the first stage and the step between them. */
const ROW_X0 = 560;
const ROW_DX = 250;
const ROW_Y = 400;

const row = (i: number) => ({ x: ROW_X0 + ROW_DX * i, y: ROW_Y });

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
    description: "The DIY route: one course from the first read-through to the final beta read.",
    offerStatus: "live",
    phases: [],
    coversPhases: ["first_read_through", "revising", "developmental_edit", "beta_readers", "line_copy_edit", "final_read_through", "final_beta_read"],
    kind: "bar",
    x: (ROW_X0 + ROW_X0 + ROW_DX * 8) / 2,
    y: 230,
    width: ROW_DX * 8 + STAGE_WIDTH,
    height: 132,
  },
  {
    id: "first-read-through",
    step: "02B",
    title: "First read-through",
    offer: "On your own",
    description: "Read the finished draft start to finish before you change anything.",
    offerStatus: "own",
    phases: ["first_read_through"],
    ...row(0),
  },
  {
    id: "revision-1",
    step: "03",
    title: "Revision",
    offer: "On your own",
    description: "Rework the manuscript with what the read-through showed you.",
    offerStatus: "own",
    phases: ["revising"],
    ...row(1),
  },
  {
    id: "developmental-edit",
    step: "04",
    title: "Developmental edit",
    offer: "Hired independently",
    description: "Pay a professional to reshape structure and story.",
    offerStatus: "external",
    phases: ["developmental_edit"],
    ...row(2),
  },
  {
    id: "revision-2",
    step: "05",
    title: "Revision",
    offer: "On your own",
    description: "Work through the editor's notes.",
    offerStatus: "own",
    phases: [],
    ...row(3),
  },
  {
    id: "beta-readers",
    step: "06",
    title: "Beta readers",
    offer: "Get feedback",
    description: "The revised manuscript in front of real readers.",
    offerStatus: "roadmap",
    phases: ["beta_readers"],
    ...row(4),
  },
  {
    id: "revision-3",
    step: "07",
    title: "Revision",
    offer: "On your own",
    description: "Fold in what your beta readers said.",
    offerStatus: "own",
    phases: [],
    ...row(5),
  },
  {
    id: "line-copy-edit",
    step: "08",
    title: "Line & copy edit",
    offer: "Hired independently",
    description: "Sharpen the voice, then polish the prose.",
    offerStatus: "external",
    phases: ["line_copy_edit"],
    ...row(6),
  },
  {
    id: "final-read-through",
    step: "09",
    title: "Final read-through",
    offer: "On your own",
    description: "One last read for anything the edits missed.",
    offerStatus: "own",
    phases: ["final_read_through"],
    ...row(7),
  },
  {
    id: "final-beta-read",
    step: "10",
    title: "Final beta read",
    offer: "Get feedback",
    description: "A last check with fresh readers before you publish.",
    offerStatus: "roadmap",
    phases: ["final_beta_read"],
    ...row(8),
  },
  {
    id: "publishing",
    step: "11",
    title: "Publishing",
    offer: "Self-publish or query",
    description: "",
    offerStatus: "roadmap",
    phases: ["publishing", "complete"],
    kind: "group",
    x: 3000,
    y: 290,
    width: 290,
    height: 500,
  },
  {
    id: "self-publish",
    step: "11A",
    title: "Self-Publish",
    offer: "Self-Publishing course",
    description: "Formatting, covers and launch mechanics.",
    offerStatus: "roadmap",
    phases: [],
    x: 3000,
    y: 140,
  },
  {
    id: "query-submit",
    step: "11B",
    title: "Query & Submit",
    offer: "Trad Publishing course",
    description: "Query letters, comp titles and agent research.",
    offerStatus: "roadmap",
    phases: [],
    x: 3000,
    y: 440,
  },
  {
    id: "arc-readers",
    step: "",
    title: "ARC readers",
    offer: "Build buzz",
    description: "Early copies, with feedback folding back in.",
    offerStatus: "roadmap",
    phases: [],
    x: 3000,
    y: 290,
  },
  {
    id: "launch",
    step: "12",
    title: "Launch & Sell",
    offer: "Marketing",
    description: "The shelf, the storefront, and the next spark.",
    offerStatus: "roadmap",
    phases: ["published"],
    x: 3280,
    y: 290,
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
  own: "You",
};
