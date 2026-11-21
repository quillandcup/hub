import {
  closedDmBlocks,
  dismissCheckinHalf,
  goneDmBlocks,
  parseCheckinAnswer,
  parseDismiss,
  parseQuickLogAnswer,
  parseSubmit,
  PRICKLE_GONE,
  QUICK_LOG_ACTION_ID,
  replaceAnsweredBlock,
  saveCheckinAnswer,
  withSavedAnswer,
  type CheckinAnswer,
  type CheckinHalfKind,
  type QuickLogAnswer,
} from "@/lib/prickle-checkin-dms";
import { MEASURE_LABELS, type WritingMeasure } from "@/lib/writing-projects";
import type { Repos } from "@/lib/data/repos";
import { isDmActionId } from "@/lib/chat/dm-controls";

export { isDmActionId };

/**
 * What a press in one of Billie Bot's check-in / check-out DMs does, once we know whose press it is. Two doors lead here and
 * resolve the member their own way: Slack's interactivity webhook (the Slack user, src/app/api/webhooks/slack/interactions/route.ts)
 * and the Hub chat, which draws the same controls (the signed-in viewer, src/app/(member)/chat/dm-controls-actions.ts). Everything
 * after that, saving the answer and writing it back into the Slack message, is the same code.
 */

/** The message an action was pressed in, and how to change it (Slack's `chat.update` on that message). */
export interface DmInteraction {
  repos: Repos;
  /** Who pressed it: never taken from the action. */
  memberId: string;
  /** The action as Slack sends it in `block_actions` (`action_id`, `block_id`, `value`, `selected_option`, ...). */
  action: any;
  /** The message as it stands now. */
  blocks: any[] | undefined;
  text: string;
  /** Replaces the message's text and blocks. */
  update: (message: { text: string; blocks: any[] }) => Promise<void>;
}

/** What happened: `ignored` is an action that is none of ours. */
export type DmInteractionResult = "handled" | "ignored";

/** The DM was about a prickle that no longer exists: say so in place of its questions, instead of leaving it looking live. */
async function replaceWithGoneNote(i: DmInteraction) {
  await i.update(goneDmBlocks());
}

/**
 * A check-in question answered in a check-in or check-out DM: save it to the member's check-in,
 * then write the pick back into the message so a later update (another answer, a quick-log
 * confirmation) doesn't reset it on screen.
 */
async function handleCheckinAnswer(i: DmInteraction, answer: CheckinAnswer) {
  const error = await saveCheckinAnswer(i.repos, i.memberId, answer);
  if (error) {
    console.error("prickle_checkin_answer: not saved", { memberId: i.memberId, prickleId: answer.prickleId, field: answer.field, error });
    if (error === PRICKLE_GONE) await replaceWithGoneNote(i);
    return;
  }
  const blocks = withSavedAnswer(i.blocks, answer);
  if (blocks) await i.update({ text: i.text, blocks });
}

/**
 * "Submit" in a DM: the answers already saved as they were picked, so this only closes the offer
 * everywhere (like a skip, which keeps what was answered) and collapses the message to a thank-you.
 */
async function handleSubmit(i: DmInteraction, half: CheckinHalfKind, prickleId: string) {
  const error = await dismissCheckinHalf(i.repos, half, i.memberId, prickleId);
  if (error) {
    if (error === PRICKLE_GONE) await replaceWithGoneNote(i);
    return;
  }
  await i.update(closedDmBlocks(half, prickleId));
}

/** "Skip check-in" / "Skip check-out" in a DM: close it everywhere and collapse the message to a note. */
async function handleDismiss(i: DmInteraction, half: CheckinHalfKind, prickleId: string) {
  const error = await dismissCheckinHalf(i.repos, half, i.memberId, prickleId);
  if (error) {
    if (error === PRICKLE_GONE) await replaceWithGoneNote(i);
    return;
  }
  const text = `Skipped this ${half === "checkin" ? "check-in" : "check-out"}.`;
  await i.update({ text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] });
}

async function handleWritingQuickLog(i: DmInteraction, { projectId, prickleId, measure, amount }: QuickLogAnswer) {
  // Never trust the project id embedded in the action value alone -- verify it's still this
  // member's project before writing anything (same principle as assertOwnsProject in
  // src/app/(member)/projects/actions.ts).
  const writing = i.repos.writing;
  const owns = await writing.ownsProject(i.memberId, projectId).catch(() => false);
  if (!owns) {
    console.error("writing_quick_log: project not found or not owned by member", { projectId, memberId: i.memberId });
    return;
  }

  let entryId: string;
  try {
    entryId = await writing.addEntry({
      projectId,
      memberId: i.memberId,
      prickleId,
      entryDate: new Date().toISOString().slice(0, 10),
      measure,
      mode: "delta",
      amount,
    });
  } catch (insertError) {
    console.error("writing_quick_log: failed to insert progress entry", insertError);
    return;
  }

  // Phase 1, item 11: same engagement signal as a manual log (see
  // src/app/(member)/projects/actions.ts logProgress) -- this is just a different entry point into
  // the same writing_progress_entries table.
  await i.repos.activities
    .record({
      memberId: i.memberId,
      type: "writing_progress_logged",
      category: "writing",
      title: "Logged writing progress",
      relatedId: entryId,
      engagementValue: 5,
      occurredAt: new Date().toISOString(),
      source: "writing_progress",
    })
    .catch((activityError) => console.error("writing_quick_log: failed to insert member_activities row", activityError));

  const measureLabel = MEASURE_LABELS[measure as WritingMeasure] ?? measure;
  const confirmation = `✅ Logged ${amount} ${measureLabel.toLowerCase()} — nice work!`;
  await i.update({ text: confirmation, blocks: replaceAnsweredBlock(i.blocks, i.action.block_id, confirmation) });
}

/** Runs one action of a check-in or check-out DM for `memberId`; an action that isn't one of ours is `ignored`. Never throws for a handler's own failure: it is logged. */
export async function handleDmInteraction(i: DmInteraction): Promise<DmInteractionResult> {
  const { action } = i;
  const run = async (label: string, work: () => Promise<void>): Promise<DmInteractionResult> => {
    try {
      await work();
    } catch (error) {
      console.error(`Error handling ${label}:`, error);
    }
    return "handled";
  };

  const submission = parseSubmit(action);
  if (submission) return run("prickle check-in submit", () => handleSubmit(i, submission.half, submission.prickleId));

  const dismissal = parseDismiss(action);
  if (dismissal) return run("prickle check-in dismissal", () => handleDismiss(i, dismissal.half, dismissal.prickleId));

  const checkinAnswer = parseCheckinAnswer(action);
  if (checkinAnswer) return run("prickle check-in answer", () => handleCheckinAnswer(i, checkinAnswer));

  if (action?.action_id !== QUICK_LOG_ACTION_ID) return "ignored";
  const quickLog = parseQuickLogAnswer(action);
  if (!quickLog) {
    console.error("writing_quick_log: malformed action or missing amount", action.block_id, action.value);
    return "handled";
  }
  return run("writing_quick_log interaction", () => handleWritingQuickLog(i, quickLog));
}
