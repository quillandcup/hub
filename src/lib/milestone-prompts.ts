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

/**
 * The groups of stages the prompt asks at most once in: 0 before the reading and editing stages (and for a stage we do not
 * know), 1 reading and editing (First read-through to Final beta read), 2 Publishing, 3 Complete and Published. "Not yet" is
 * remembered with the group the project was in, and the question comes back only when the project reaches a later group.
 */
const GROUP_1 = ["first_read_through", "revising", "developmental_edit", "beta_readers", "line_copy_edit", "final_read_through", "final_beta_read"];
export type StageGroup = 0 | 1 | 2 | 3;
export function stageGroupOf(phase: string | null): StageGroup {
  if (phase === null) return 0;
  if (GROUP_1.includes(phase)) return 1;
  if (phase === "publishing") return 2;
  if (phase === "complete" || phase === "published") return 3;
  return 0;
}

/** A kind the member said "not yet" to, and the stage group the project was in when they did. */
export type Snooze = { kind: MilestoneKind; stageGroup: number };

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
export function milestonesToAsk(from: string | null, to: string, hasBook: boolean, snoozes: readonly Snooze[] = []): StageMove {
  const none: StageMove = { kinds: [], offerPublish: false };
  if (from === to || index(to) < 0 || to === "hibernating") return none;
  const kinds = new Set<MilestoneKind>();
  const movedForward = from !== null && from !== "hibernating" && index(to) > index(from);
  if (from !== null && BEFORE_THE_END.includes(from) && index(to) > index("drafting")) kinds.add("the_end");
  if (to === "publishing" && (movedForward || from === "hibernating")) kinds.add("publish_ready");
  // A kind the member said "not yet" to comes back when the project reaches a stage that means it, in a later group than the one
  // they said it in: THE END at any stage after drafting, publish-ready at Publishing. Never twice in the same group.
  const group = stageGroupOf(to);
  for (const snooze of snoozes) {
    if (group <= snooze.stageGroup) {
      kinds.delete(snooze.kind);
      continue;
    }
    if (snooze.kind === "the_end" && index(to) > index("drafting")) kinds.add("the_end");
    if (snooze.kind === "publish_ready" && to === "publishing") kinds.add("publish_ready");
  }
  const offerPublish = (to === "complete" || to === "published") && !hasBook;
  return { kinds: MILESTONE_KINDS.filter((k) => kinds.has(k)), offerPublish };
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
  /** "Not yet" is a snooze: we ask again at a later stage. "Not for this work" is the one that is never asked again. */
  notForThisWork: "Not for this work",
  /** Said after "Not yet": we will ask again later, and it can be added any time. */
  notYetNote: "That's fine. We'll ask again at a later stage. You can add it any time from the project's Milestones.",
  /** Said after "Not for this work". */
  notForThisWorkNote: "That's fine. We won't ask about this project again. You can still add it any time from its Milestones.",
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
