/**
 * The `courses:content --responses` run, apart from the browser (docs/product/COURSES.md, "Importing past quiz responses"): given
 * the quizzes of a course and a way to read one quiz's Results tab and each submission's grading view, it saves every submission to
 * `bronze.kajabi_quiz_responses` and copies uploaded files into storage.
 *
 * Nothing here prints or returns a name, an email, an answer or a file name: the summary and the log lines are counts, and an
 * unreadable page is described by field names and types only. A submission is never removed from Bronze because Kajabi no longer
 * lists it: leaving Kajabi must not lose anyone's writing. Relative imports only: the script that calls this runs outside Next.
 */

import type { Db } from "../data/db";
import { SupabaseKajabiCourseRepository } from "../data/kajabi-courses";
import { checkQuizFile } from "../courses/quiz-files";
import { describeJson } from "./probe";
import {
  addFileCounts,
  copyResponseFiles,
  parseSubmission,
  saveQuizResponse,
  typeValuesIn,
  storedAnswersOf,
  type FileCopyCounts,
  type FileCopyIO,
  type ResponseSaveOutcome,
  type StoredAnswer,
} from "./quiz-responses";

/** The Kajabi login is no longer valid: stop the run and log in again. */
export class ResponsesSessionExpiredError extends Error {}

export interface QuizToRead {
  quizKajabiId: string;
  courseKajabiId: string;
}

/** What reading one quiz's Results tab gave. */
export interface QuizRead {
  /** The submissions the Results tab listed (rows), when it said. */
  listed: number | null;
  /** One entry per submission opened: the key the capture knows it by (from its address), and the JSON documents its view loaded. */
  submissions: { key: string | null; documents: unknown[] }[];
  /** Submissions that could not be opened. */
  failed: number;
  /** How the list was paged, when it was read by id (printed so a run says what it could and couldn't do). */
  paging?: "single_page" | "paged" | "could_not_page" | "page_limit";
  /** The Results tab could not be read to the end (a page failed to load): nothing about it is complete. */
  incomplete: boolean;
}

export interface ResponsesSummary {
  quizzes: number;
  quizzesFailed: number;
  /** Rows the Results tabs listed (where they said), and submissions opened and read. */
  listed: number;
  read: number;
  /** Submissions opened that could not be read (no email, or no answers found). */
  unreadable: number;
  /** Submissions whose responder was removed on their request (`removal_tombstones`): nothing is stored or copied for them. */
  removedResponders: number;
  openFailed: number;
  /** Submissions the lists named that were never opened (neither read nor reported failed): listed and read must reconcile. */
  notOpened: number;
  rows: Record<ResponseSaveOutcome, number>;
  responders: number;
  answers: number;
  files: FileCopyCounts;
  /** The distinct `type` and `questionType` values the submissions carried: Kajabi's own enum names (never member data), printed so the reading can be settled from facts. */
  seen: { types: string[]; questionTypes: string[] };
}

export async function runResponsesCapture(opts: {
  db: Db;
  quizzes: QuizToRead[];
  readQuiz: (quiz: QuizToRead) => Promise<QuizRead>;
  fileIO: FileCopyIO;
  apply: boolean;
  log: (line: string) => void;
  now?: Date;
}): Promise<ResponsesSummary> {
  const repo = new SupabaseKajabiCourseRepository(opts.db);
  const now = opts.now ?? new Date();
  const summary: ResponsesSummary = {
    quizzes: 0,
    quizzesFailed: 0,
    listed: 0,
    read: 0,
    unreadable: 0,
    removedResponders: 0,
    openFailed: 0,
    notOpened: 0,
    rows: { created: 0, updated: 0, unchanged: 0 },
    responders: 0,
    answers: 0,
    files: { copied: 0, alreadyCopied: 0, failed: {} },
    seen: { types: [], questionTypes: [] },
  };
  const responders = new Set<string>();
  const seenTypes = new Set<string>();
  const seenQuestionTypes = new Set<string>();
  // Who asked to be removed (a fingerprint of the address, `removal_tombstones`): looked up once per address, before anything is
  // copied or stored, so a removed member's files are never downloaded again.
  const removedByEmail = new Map<string, boolean>();
  const isRemoved = async (email: string) => {
    if (!removedByEmail.has(email)) removedByEmail.set(email, (await repo.removedEmails([email])).size > 0);
    return removedByEmail.get(email)!;
  };

  for (const quiz of opts.quizzes) {
    summary.quizzes++;
    let read: QuizRead;
    try {
      read = await opts.readQuiz(quiz);
    } catch (error) {
      if (error instanceof ResponsesSessionExpiredError) throw error;
      summary.quizzesFailed++;
      opts.log(`quiz ${quiz.quizKajabiId}: could not be read (${error instanceof Error ? error.message : "unknown error"})`);
      continue;
    }
    if (read.listed !== null) summary.listed += read.listed;
    summary.openFailed += read.failed;
    const notOpened = read.listed === null ? 0 : Math.max(0, read.listed - read.submissions.length - read.failed);
    summary.notOpened += notOpened;

    const counts = { created: 0, updated: 0, unchanged: 0, unreadable: 0, removed: 0 };
    let shown = false;
    const seen = new Set<string>();
    for (const opened of read.submissions) {
      const values = typeValuesIn(opened.documents);
      for (const t of values.types) seenTypes.add(t);
      for (const t of values.questionTypes) seenQuestionTypes.add(t);
      const parsed = parseSubmission(opened.documents, opened.key);
      if (!parsed) {
        counts.unreadable++;
        summary.unreadable++;
        if (!shown) {
          // Field names and types only, so the reading can be fixed from facts.
          shown = true;
          for (const [i, doc] of opened.documents.entries()) for (const line of describeJson(doc)) opts.log(`  quiz ${quiz.quizKajabiId}, an unreadable submission, doc ${i + 1}: ${line}`);
        }
        continue;
      }
      if (seen.has(parsed.submissionKey)) continue;
      seen.add(parsed.submissionKey);
      if (await isRemoved(parsed.email)) {
        counts.removed++;
        summary.removedResponders++;
        continue;
      }
      summary.read++;
      responders.add(parsed.email);

      const existing = await repo.quizResponse(quiz.quizKajabiId, parsed.submissionKey);
      const parsedAnswers: StoredAnswer[] = parsed.answers.map((a) => ({ ...a, file: a.file ? { ...a.file, storagePath: null, copyFailure: null } : null }));
      const copied = await copyResponseFiles(
        opts.fileIO,
        checkQuizFile,
        { quizKajabiId: quiz.quizKajabiId, submissionKey: parsed.submissionKey, answers: parsedAnswers, previous: existing ? storedAnswersOf(existing.answers) : [] },
        !opts.apply,
      );
      addFileCounts(summary.files, copied.counts);
      summary.answers += copied.answers.length;
      const outcome = await saveQuizResponse(
        opts.db as never,
        { quizKajabiId: quiz.quizKajabiId, submissionKey: parsed.submissionKey, courseKajabiId: quiz.courseKajabiId, email: parsed.email, submittedAt: parsed.submittedAt, answers: copied.answers },
        now,
        { dryRun: !opts.apply },
      );
      counts[outcome]++;
      summary.rows[outcome]++;
    }
    summary.responders = responders.size;
    opts.log(
      `quiz ${quiz.quizKajabiId}: ${read.listed ?? "?"} listed, ${read.submissions.length} opened, ${read.failed} failed to open, ${counts.unreadable} unreadable, ${counts.removed} skipped (removed on request), ${counts.created} new, ${counts.updated} changed, ${counts.unchanged} unchanged${notOpened > 0 ? `, ${notOpened} listed but never opened` : ""}${read.paging === "could_not_page" ? " (could not page the list: the page parameter was not accepted)" : read.paging === "page_limit" ? " (stopped at the page limit)" : ""}${read.incomplete ? " (the Results tab was not read to the end)" : ""}`,
    );
  }
  summary.seen = { types: [...seenTypes].sort().slice(0, 30), questionTypes: [...seenQuestionTypes].sort().slice(0, 30) };
  opts.log(`resource types seen: ${summary.seen.types.join(", ") || "none"}; question types seen: ${summary.seen.questionTypes.join(", ") || "none"}`);
  return summary;
}

/** The closing lines: counts only. */
export function formatResponsesTotals(apply: boolean, s: ResponsesSummary): string {
  const failedFiles = Object.entries(s.files.failed)
    .map(([reason, n]) => `${n} ${reason}`)
    .join(", ");
  return (
    `${apply ? "Written" : "Dry run, nothing written"}: ${s.quizzes} quizzes (${s.quizzesFailed} could not be read), ${s.listed} submissions listed, ${s.read} read from ${s.responders} responders ` +
    `(${s.unreadable} unreadable, ${s.removedResponders} skipped because the member was removed on request, ${s.openFailed} could not be opened, ${s.notOpened} listed but never opened); rows ${s.rows.created} new, ${s.rows.updated} changed, ${s.rows.unchanged} unchanged; ${s.answers} answers; ` +
    `files ${s.files.copied} ${apply ? "copied" : "would copy"}, ${s.files.alreadyCopied} already copied${failedFiles ? `, could not copy: ${failedFiles}` : ""}.`
  );
}
