import type { ProjectPhase } from "@/lib/writing-projects";

/**
 * Spark to Shelf: the stages a book goes through at Quill & Cup and the offer at each (the same map
 * as docs/pipeline-map.html). A project's position is derived from its status, never stored. `on_hold`
 * and `hibernating` are not positions: they pause or end a project at any stage.
 */
export type JourneyOffer = "live" | "external" | "roadmap";

export interface JourneyStage {
  id: string;
  title: string;
  /** The Quill & Cup program or course at this stage, or who to hire. */
  offer: string;
  description: string;
  /** live: ours today; external: hired outside Quill & Cup; roadmap: planned. */
  offerStatus: JourneyOffer;
  /** Statuses that put a project at this stage. */
  phases: ProjectPhase[];
}

export const JOURNEY_STAGES: JourneyStage[] = [
  {
    id: "draft",
    title: "Draft",
    offer: "180 Program",
    description: "180 days of daily sprints and weekly prompts, turning a spark into a finished manuscript.",
    offerStatus: "live",
    phases: ["planning", "outlining", "drafting"],
  },
  {
    id: "self-edit",
    title: "Self-Edit",
    offer: "Self-Editing Academy",
    description: "A self-taught pass at structure and story, the DIY alternative to hiring a developmental editor.",
    offerStatus: "live",
    phases: ["revising"],
  },
  {
    id: "developmental-edit",
    title: "Developmental edit",
    offer: "Hired independently",
    description: "Or pay a professional to reshape structure and story for you.",
    offerStatus: "external",
    phases: ["developmental_edit"],
  },
  {
    id: "beta-readers",
    title: "Beta readers",
    offer: "Beta readers",
    description: "Full manuscripts in front of real readers, whichever edit path got you here.",
    offerStatus: "roadmap",
    phases: ["beta_readers"],
  },
  {
    id: "line-copy-edit",
    title: "Line & copy edit",
    offer: "Hired independently",
    description: "Sharpen the voice, then polish the prose, after the beta reads.",
    offerStatus: "external",
    phases: ["line_copy_edit"],
  },
  {
    id: "publish",
    title: "Publish",
    offer: "Self-Publishing or Query & Submit courses",
    description: "Self-publish, or query agents for a traditional deal. ARC readers get early copies while you finish.",
    offerStatus: "roadmap",
    phases: ["complete"],
  },
  {
    id: "launch",
    title: "Launch & Sell",
    offer: "Marketing",
    description: "The shelf, the storefront, and the next spark.",
    offerStatus: "roadmap",
    phases: ["published"],
  },
];

/** The stage a project in `phase` is at, or null when the status isn't a position (on hold, hibernating). */
export function journeyStageForPhase(phase: string): JourneyStage | null {
  return JOURNEY_STAGES.find((s) => (s.phases as string[]).includes(phase)) ?? null;
}

export const JOURNEY_OFFER_LABELS: Record<JourneyOffer, string> = {
  live: "Quill & Cup",
  external: "Hire a pro",
  roadmap: "On the roadmap",
};
