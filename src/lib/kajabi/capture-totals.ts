import type { CommentsSummary } from "@/lib/kajabi/comments-run";
import type { ProgressSummary } from "@/lib/kajabi/progress-run";

/**
 * The totals each Kajabi capture prints when it ends. `scripts/kajabi-course-content.ts` prints these and
 * `pnpm courses:migrate` (`src/lib/courses/migrate.ts`) reads them back, so the text is built here, once, and the
 * migrate tests parse what these functions return rather than a hand-copied string.
 */

export type CaptureVerb = "Done" | "Dry run, nothing written";

export const captureVerb = (apply: boolean): CaptureVerb => (apply ? "Done" : "Dry run, nothing written");

export interface ContentTotals {
  updated: number;
  urlsRefreshed: number;
  unchanged: number;
  missing: number;
  failed: number;
  quizzes: { total: number; created: number; updated: number; unchanged: number; noQuestionRead: number };
}

/** The lesson-content capture's totals line. */
export function formatContentTotals(apply: boolean, t: ContentTotals): string {
  const q = t.quizzes;
  return (
    `${captureVerb(apply)}: ${t.updated} updated, ${t.urlsRefreshed} links refreshed, ` +
    `${t.unchanged} unchanged, ${t.missing} not in Bronze, ${t.failed} failed; ` +
    `${q.total} quizzes (${q.created} new, ${q.updated} changed, ${q.unchanged} unchanged, ${q.noQuestionRead} with no question read)`
  );
}

/** The progress capture's two totals lines. */
export function formatProgressTotals(apply: boolean, summary: ProgressSummary): string {
  const { roster: r, lessons: l } = summary;
  return (
    `\n${captureVerb(apply)}: ${summary.members} students in the roster ` +
    `(${r.written} written, ${r.unchanged} unchanged, ${r.removed} removed; ${summary.rosterSkipped} unusable, ${summary.duplicateEmails} duplicate emails)\n` +
    `lessons: ${summary.membersCaptured} students captured, ${summary.lessonsListed} lessons listed, ${summary.lessonsCompleted} completed; ` +
    `${l.written} rows written, ${l.unchanged} unchanged, ${l.removed} removed; ` +
    `${summary.membersWithoutLessons} students with no lessons, ${summary.membersFailed} failed, ${summary.lessonsNotInBronze} lessons not in Bronze`
  );
}

/** The comments capture's three totals lines. */
export function formatCommentsTotals(apply: boolean, summary: CommentsSummary): string {
  const k = summary.keySources;
  return (
    `\n${captureVerb(apply)}: ${summary.lessonsCaptured} lessons captured, ${summary.lessonsWithComments} with comments; ` +
    `${summary.comments} comments and replies (${summary.replies} replies); ` +
    `${summary.rows.written} rows written, ${summary.rows.unchanged} unchanged, ${summary.rows.removed} removed\n` +
    `comment ids: ${k["reply-link"] + k["reply-container"] + k["data-comment"]} from the page (${k["reply-link"]} reply link, ${k["reply-container"]} reply container, ${k["data-comment"]} data-comment), ${k.hash} hashed, ${summary.duplicateKeys} repeated within a lesson\n` +
    `lessons: ${summary.lessonsCapped} cut off at the Show More limit, ${summary.lessonsMismatched} with a different total on the page, ` +
    `${summary.lessonsNoComments} with no comments (the page has a comment box), ${summary.lessonsQuizzes} quizzes (no comments by design), ${summary.lessonsLocked} locked until an earlier lesson is completed (their comments cannot be read from this preview), ${summary.lessonsWithoutList} with none of those (look at these), ${summary.lessonsFailed} failed, ${summary.lessonsNotInBronze} not in Bronze (skipped)\n` +
    `seen: ${summary.lessonsListed} lessons in the posts list, ${summary.lessonsCaptured} read, ${summary.lessonsWithComments} with comments, ${summary.comments} comments and replies (${summary.replies} replies), ${summary.presses} Show More or similar controls pressed\n` +
    `warnings: ${summary.warnings.length}` +
    (summary.warnings.length === 0
      ? " (none)"
      : ` (${summary.lessonsEmptyList} comments list empty or with a total but nothing read, ${summary.lessonsPendingControls} with a Show More or replies control still on the page, ${summary.lessonsWithFrames} with a frame that could hold comments, ${summary.removalsHeld} stored comments not marked removed because the read was not shown to be complete, ${summary.lessonsMismatched} total mismatches, ${summary.lessonsCapped} cut off, ${summary.lessonsFailed} failed). Compare the lessons and comment counts above with Kajabi, and open the lessons named in the WARNING lines above`)
  );
}
