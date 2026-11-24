import { QUIZ_ANSWERS } from "@/lib/config";
import { newQuizFilePath } from "@/lib/courses/quiz-files";
import { hasGradedQuestions } from "@/lib/courses/quiz-editor";
import { buildAliasMap, resolveEmail } from "@/lib/email-aliases";
import { answersFromJson, type StoredAnswer } from "@/lib/kajabi/quiz-responses";
import type { NewQuizAnswer, QuizQuestionRecord, QuizRecord } from "@/lib/data/quizzes";
import type { Repos } from "@/lib/data/repos";

type ResponseImportRepos = Pick<Repos, "aliases" | "courseProgress" | "courses" | "kajabiCourses" | "members" | "quizzes">;

/**
 * Bronze (bronze.kajabi_quiz_responses) -> Local quiz attempts (docs/product/COURSES.md, "Importing past quiz responses").
 *
 * Members' own writing and files must outlive Kajabi, so this is built around not losing anything:
 *  - Bronze keeps every submission for every responder, member or not. Nothing here drops a Bronze row; a responder with no Hub
 *    member yet is counted ("kept, no member yet") and picked up by a later run once a member with that email exists.
 *  - The match is by email only, to ANY existing member (current, lapsed, cancelled, on hiatus), through their own email or an
 *    active alias (a merged member's other addresses are aliases of the member who was kept). One email shared by several members
 *    is ambiguous and skipped, never guessed. No course access is needed: a member without access can't open the lesson, so their
 *    imported answers are for staff to read, and for them again if access returns. Members are never created from this.
 *  - It is insert only. An attempt is added once per Kajabi submission (the database refuses a second), a Hub-made attempt has no
 *    key and is never touched, and running it again inserts nothing the second time. Imported attempts are marked
 *    `imported_from = 'kajabi'`, are not scored, and notify nobody (nothing here calls the notifier).
 *  - Files were copied into the private bucket when they were captured (`kajabi-import/...`); each is copied again into the member's
 *    own folder, so a removal request deletes it, and the Bronze copy stays for reprocessing.
 *  - A submission counts as completing a quiz lesson only for a quiz with nothing graded, only for a member with current access to
 *    the course (the same rule as the Kajabi progress import: a member without access gets no completion), and only where the
 *    member has no progress row for the lesson. Existing progress is never changed.
 */

export interface QuizResponseImport {
  slug: string;
  /** Live submissions in Bronze for the course. */
  submissionsInBronze: number;
  /** Distinct responder emails, by how they matched a member. */
  responders: { matched: number; keptNoMember: number; ambiguous: number };
  submissions: {
    /** Attempts inserted (or, in a dry run, that would be). */
    imported: number;
    alreadyImported: number;
    /** Kept in Bronze, no member has that email yet. */
    keptNoMember: number;
    ambiguous: number;
    /** The quiz isn't in the Hub (not synced, or taken over and re-keyed). */
    noQuiz: number;
  };
  answers: { imported: number; questionGone: number; unreadable: number };
  files: { copied: number; notCopied: number };
  completions: { added: number; alreadyHad: number; noAccess: number };
}

export interface QuizResponseImportResult {
  dryRun: boolean;
  courses: QuizResponseImport[];
}

export class QuizResponseImportError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface ResponseImportDeps {
  /** Copies a stored file to another path of the answer-files bucket; false when storage refused. */
  copyFile(from: string, to: string): Promise<boolean>;
  /** A random folder name for a copied file (a UUID). */
  randomId(): string;
}

const norm = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

/** What a Bronze answer becomes for the question it answers, or why it can't. */
export function mapAnswer(
  question: QuizQuestionRecord,
  answer: StoredAnswer,
): { ok: true; selectedOptionIds: string[]; answerText: string | null; file: StoredAnswer["file"] } | { ok: false } {
  if (question.kind === "choice") {
    const bySource = new Map(question.options.flatMap((o) => (o.sourceKey ? [[o.sourceKey, o.id] as [string, string]] : [])));
    const ids = new Set<string>(answer.optionKeys.flatMap((k) => (bySource.has(k) ? [bySource.get(k)!] : [])));
    // The key didn't match (the option was re-keyed): its wording, as shown in the submission, is the next best thing.
    if (ids.size === 0) for (const label of answer.optionLabels) for (const o of question.options) if (norm(o.label) === norm(label)) ids.add(o.id);
    return ids.size === 0 ? { ok: false } : { ok: true, selectedOptionIds: question.options.filter((o) => ids.has(o.id)).map((o) => o.id), answerText: null, file: null };
  }
  if (question.kind === "short_answer") {
    const text = answer.text?.trim();
    return text ? { ok: true, selectedOptionIds: [], answerText: text.slice(0, 20000), file: null } : { ok: false };
  }
  return answer.file ? { ok: true, selectedOptionIds: [], answerText: null, file: answer.file } : { ok: false };
}

export async function importKajabiQuizResponses(
  repos: ResponseImportRepos,
  deps: ResponseImportDeps,
  options: { courseSlug?: string; dryRun?: boolean; now?: Date } = {},
): Promise<QuizResponseImportResult> {
  const dryRun = options.dryRun ?? false;
  const now = options.now ?? new Date();
  const only = options.courseSlug ? await repos.courses.courseBySlug(options.courseSlug, { source: "kajabi" }) : null;
  const courses = options.courseSlug ? (only ? [only] : []) : await repos.courses.courses({ source: "kajabi" });
  if (options.courseSlug && courses.length === 0) throw new QuizResponseImportError(`No Kajabi course has the slug "${options.courseSlug}"`, 404);

  const [identities, aliases] = await Promise.all([repos.members.identities(), repos.aliases.emailAliases({ activeOnly: true })]);
  const aliasMap = buildAliasMap(aliases);
  const memberIdsByEmail = new Map<string, string[]>();
  for (const m of identities) {
    const key = m.email.trim().toLowerCase();
    memberIdsByEmail.set(key, [...(memberIdsByEmail.get(key) ?? []), m.id]);
  }

  const result: QuizResponseImportResult = { dryRun, courses: [] };
  for (const course of courses) {
    const summary: QuizResponseImport = {
      slug: course.slug,
      submissionsInBronze: 0,
      responders: { matched: 0, keptNoMember: 0, ambiguous: 0 },
      submissions: { imported: 0, alreadyImported: 0, keptNoMember: 0, ambiguous: 0, noQuiz: 0 },
      answers: { imported: 0, questionGone: 0, unreadable: 0 },
      files: { copied: 0, notCopied: 0 },
      completions: { added: 0, alreadyHad: 0, noAccess: 0 },
    };
    result.courses.push(summary);
    if (!course.source_key) continue;
    const bronze = await repos.kajabiCourses.quizResponsesOfCourse(course.source_key);
    summary.submissionsInBronze = bronze.length;
    if (bronze.length === 0) continue;

    // Who each Bronze email is, once per email.
    const memberOfEmail = new Map<string, string | null>();
    for (const email of new Set(bronze.map((r) => r.email))) {
      const ids = memberIdsByEmail.get(resolveEmail(email, aliasMap)) ?? [];
      memberOfEmail.set(email, ids.length === 1 ? ids[0] : null);
      if (ids.length === 0) summary.responders.keptNoMember++;
      else if (ids.length > 1) summary.responders.ambiguous++;
      else summary.responders.matched++;
    }

    const quizByKey = await repos.quizzes.quizzesBySourceKeys([...new Set(bronze.map((r) => r.quiz_kajabi_id))]);
    const quizzes = [...quizByKey.values()];
    const questionsByQuiz = new Map<string, QuizQuestionRecord[]>(await Promise.all(quizzes.map(async (q) => [q.id, await repos.quizzes.questionsOf(q.id)] as [string, QuizQuestionRecord[]])));
    const already = await repos.quizzes.importedSourceKeys(quizzes.map((q) => q.id));

    const access = await repos.courseProgress.accessOfCourses([course.id]);
    const hasAccess = new Set<string>(access.filter((a) => a.ends_at === null || new Date(a.ends_at).getTime() > now.getTime()).map((a) => a.member_id));

    // One completion candidate per (member, lesson): the earliest submission.
    const completionCandidates = new Map<string, { memberId: string; lessonId: string; at: string }>();

    for (const row of bronze) {
      const quiz: QuizRecord | undefined = quizByKey.get(row.quiz_kajabi_id);
      if (!quiz) {
        summary.submissions.noQuiz++;
        continue;
      }
      const memberId = memberOfEmail.get(row.email) ?? null;
      if (!memberId) {
        // No member yet, or more than one: kept in Bronze, never guessed, never dropped.
        if ((memberIdsByEmail.get(resolveEmail(row.email, aliasMap)) ?? []).length > 1) summary.submissions.ambiguous++;
        else summary.submissions.keptNoMember++;
        continue;
      }
      const questions = questionsByQuiz.get(quiz.id) ?? [];

      // Completion: only a quiz with nothing graded, only with current access, earliest submission first.
      if (!hasGradedQuestions(questions)) {
        if (!hasAccess.has(memberId)) summary.completions.noAccess++;
        else {
          const at = new Date(row.submitted_at ?? row.captured_at).toISOString();
          const key = `${memberId}|${quiz.lessonId}`;
          const earlier = completionCandidates.get(key);
          if (!earlier || at < earlier.at) completionCandidates.set(key, { memberId, lessonId: quiz.lessonId, at });
        }
      }

      if (already.has(`${quiz.id}|${row.submission_key}`)) {
        summary.submissions.alreadyImported++;
        continue;
      }

      const byKey = new Map(questions.flatMap((q) => (q.sourceKey ? [[q.sourceKey, q] as [string, QuizQuestionRecord]] : [])));
      const answers: NewQuizAnswer[] = [];
      let filesCopied = 0;
      let filesNotCopied = 0;
      for (const stored of answersFromJson(row.answers)) {
        const question = byKey.get(stored.questionKey);
        if (!question) {
          summary.answers.questionGone++;
          continue;
        }
        const mapped = mapAnswer(question, stored);
        if (!mapped.ok) {
          // A file whose copy is missing is the one thing worth telling apart: the member's file isn't in the Hub.
          if (question.kind === "file_upload" && stored.file) filesNotCopied++;
          else summary.answers.unreadable++;
          continue;
        }
        let file: NewQuizAnswer["file"] = null;
        if (mapped.file) {
          if (!mapped.file.storagePath) {
            filesNotCopied++;
            continue;
          }
          // Each member's file is copied into their own folder, so removing a member deletes it; the Bronze copy stays.
          const to = newQuizFilePath(memberId, mapped.file.name, deps.randomId());
          const copied = dryRun ? true : await deps.copyFile(mapped.file.storagePath, to);
          if (!copied) {
            filesNotCopied++;
            continue;
          }
          filesCopied++;
          file = { path: to, name: mapped.file.name.slice(0, 200), bytes: Math.min(mapped.file.bytes ?? 0, QUIZ_ANSWERS.maxFileBytes) };
        }
        answers.push({ questionId: question.id, selectedOptionIds: mapped.selectedOptionIds, isCorrect: null, answerText: mapped.answerText, file, promptSnapshot: stored.prompt });
      }

      if (dryRun) {
        summary.submissions.imported++;
        summary.answers.imported += answers.length;
        summary.files.copied += filesCopied;
        summary.files.notCopied += filesNotCopied;
        continue;
      }
      const outcome = await repos.quizzes.importAttempt({ quizId: quiz.id, memberId, sourceKey: row.submission_key, submittedAt: row.submitted_at, answers });
      if (outcome === "exists") {
        summary.submissions.alreadyImported++;
        continue;
      }
      summary.submissions.imported++;
      summary.answers.imported += answers.length;
      summary.files.copied += filesCopied;
      summary.files.notCopied += filesNotCopied;
    }

    // What the members already have for these lessons: never changed.
    const lessonIds = [...new Set([...completionCandidates.values()].map((c) => c.lessonId))];
    const existing = new Map<string, string | null>();
    for (const r of lessonIds.length > 0 ? await repos.courseProgress.progressOfLessons(lessonIds) : []) existing.set(`${r.member_id}|${r.lesson_id}`, r.completed_at);
    const toInsert: { member_id: string; lesson_id: string; completed_at: string; last_position_seconds: number; imported_from: string }[] = [];
    for (const [key, c] of completionCandidates) {
      if (existing.has(key)) {
        summary.completions.alreadyHad++;
        continue;
      }
      toInsert.push({ member_id: c.memberId, lesson_id: c.lessonId, completed_at: c.at, last_position_seconds: 0, imported_from: "kajabi" });
    }
    if (!dryRun) await repos.courseProgress.insertProgressIfAbsent(toInsert);
    summary.completions.added = toInsert.length;
  }
  return result;
}
