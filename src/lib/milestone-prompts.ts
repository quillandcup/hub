import { MILESTONE_KINDS, type MilestoneKind } from "@/lib/finishers";
import { PROJECT_PHASES } from "@/lib/writing-projects";

/**
 * The project-stage prompt (docs/product/FINISHERS.md, "The project-stage prompt"): when a member moves a project to a stage that
 * means a milestone, we ask once whether to record it. Plain module (no server imports) so the status dropdown, the dialog and the
 * action share the rules and the words.
 */

const PHASES = PROJECT_PHASES as readonly string[];
const index = (phase: string) => PHASES.indexOf(phase);

/** Stages before the first draft is finished: leaving one of them for a later stage is when THE END may have happened. */
const BEFORE_THE_END = ["planning", "outlining", "drafting"];

/** What a move from one stage to another could be asking about. Existing milestones are not looked at here: the caller filters them. */
export type StageMove = { kinds: MilestoneKind[]; offerPublish: boolean };

/**
 * Which milestones a move from `from` to `to` could ask about, and whether to offer the Publish flow.
 *
 * - THE END: leaving Planning, Outlining or Drafting for any later stage except Hibernating.
 * - Publish-ready: reaching Publishing from a stage before it (Hibernating is not "before": we do not know where the project was,
 *   so only a move straight to Publishing from it asks).
 * - Moving back a stage, to Hibernating, or to the same stage asks nothing; and nothing ever cancels a milestone.
 * - The Publish flow is offered on reaching Complete or Published, when the project has no Bookshelf book yet.
 */
export function milestonesToAsk(from: string | null, to: string, hasBook: boolean): StageMove {
  const none: StageMove = { kinds: [], offerPublish: false };
  if (from === to || index(to) < 0 || to === "hibernating") return none;
  const kinds: MilestoneKind[] = [];
  const movedForward = from !== null && from !== "hibernating" && index(to) > index(from);
  if (from !== null && BEFORE_THE_END.includes(from) && index(to) > index("drafting")) kinds.push("the_end");
  if (to === "publishing" && (movedForward || from === "hibernating")) kinds.push("publish_ready");
  const offerPublish = (to === "complete" || to === "published") && !hasBook;
  return { kinds: MILESTONE_KINDS.filter((k) => kinds.includes(k)), offerPublish };
}

/** What the status change hands to the dialog: the project, and what to ask. Nothing in it is anything the member wrote but the project's own title. */
export type StageMilestonePrompt = {
  projectId: string;
  projectTitle: string;
  kinds: MilestoneKind[];
  offerPublish: boolean;
};

/** The words of the dialog, in the voice of docs/product/WRITER_TITLES.md. The titles (Finisher, Author) come from `src/lib/finishers.ts`. */
export const STAGE_PROMPT = {
  intro: "That's a big step.",
  /** The question for one milestone, naming the project. */
  question: (kind: MilestoneKind, title: string): string =>
    kind === "the_end" ? `Did you write THE END on ${title}?` : `Is ${title} ready to publish?`,
  /** The question when both are asked at once, for a project that jumped straight to Publishing. */
  both: "Did you write THE END, and is it ready to publish?",
  /** Each step's name, in the two-step dialog. */
  step: { the_end: "I wrote THE END", publish_ready: "It is ready to publish" } as Record<MilestoneKind, string>,
  yes: { the_end: "Yes, I wrote THE END", publish_ready: "Yes, it is ready to publish" } as Record<MilestoneKind, string>,
  notYet: "Not yet",
  /** Said after "Not yet": it is remembered, and the card is still there. */
  notYetNote: "That's fine. We won't ask about this again. You can add it any time in Settings, Profile, Your milestones.",
  /** Said under the question: only the member says it, and nothing is lost by waiting. */
  reassurance: "Only you can say so, and there is no hurry.",
  done: "Done",
  notNow: "Close for now",
  /** The Publish flow, for a project that reached Complete with no book on the Bookshelf. */
  publishTitle: (title: string): string => `Congratulations on finishing ${title}.`,
  publishQuestion: "Is it out in the world? If so, you can put it on your Bookshelf.",
  publishButton: "Add it to my Bookshelf",
  /** The saved answer's error when the project is not the member's. */
  notFound: "We couldn't find that project.",
} as const;
