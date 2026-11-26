import { QUIZ_ANSWERS } from "@/lib/config";
import { newQuizFilePath } from "@/lib/courses/quiz-files";
import { buildAliasMap, resolveEmail } from "@/lib/email-aliases";
import { answersFromJson, kindOfTypeName, type StoredAnswer } from "@/lib/kajabi/quiz-responses";
import type { NewQuizAnswer, QuizQuestionRecord, QuizRecord, UnlinkedAnswer } from "@/lib/data/quizzes";
import type { Repos } from "@/lib/data/repos";

type ResponseImportRepos = Pick<Repos, "aliases" | "courses" | "kajabiCourses" | "members" | "quizzes">;

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
 *  - It never marks a lesson complete: that comes from the separate Kajabi progress import (`courses:migrate`, step P2,
 *    src/lib/courses/progress-import.ts), the one place that decides who completed what. This only writes attempts and answers.
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
  /** `unlinked`: answers kept on the attempt with their own wording because no question of the Hub's quiz could be matched to them (the quiz was edited after they were given). */
  answers: { imported: number; unlinked: number; questionGone: number; unreadable: number };
  files: { copied: number; notCopied: number };
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

/**
 * The question of the Hub's quiz an answer belongs to. Kajabi's editor keys a question by its id; a submission's answer may carry that
 * id, or only the question's title and 1-based position (the real shape). By id when there is one; otherwise by position in the quiz
 * with the title as a check: a quiz edited after the answer was given no longer lines up, and then there is no link (null), never a
 * guess. The kind the submission names, when it names one, must agree too.
 */
export function questionOfAnswer(questions: readonly QuizQuestionRecord[], stored: StoredAnswer): QuizQuestionRecord | null {
  const byId = questions.find((q) => q.sourceKey !== null && q.sourceKey === stored.questionKey);
  if (byId) return byId;
  if (stored.position === null || stored.position === undefined || !stored.prompt) return null;
  const candidate = [...questions].sort((a, b) => a.position - b.position)[stored.position - 1];
  if (!candidate || norm(candidate.prompt) !== norm(stored.prompt)) return null;
  const named = kindOfTypeName(stored.questionType);
  return named && named !== candidate.kind ? null : candidate;
}

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
    if (ids.size > 0) return { ok: true, selectedOptionIds: question.options.filter((o) => ids.has(o.id)).map((o) => o.id), answerText: null, file: null };
    // No option of the Hub's question has that wording (it was reworded since): keep what was picked as text, never choose an option for them.
    return answer.optionLabels.length > 0 ? { ok: true, selectedOptionIds: [], answerText: answer.optionLabels.join("\n").slice(0, 20000), file: null } : { ok: false };
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
  options: { courseSlug?: string; dryRun?: boolean } = {},
): Promise<QuizResponseImportResult> {
  const dryRun = options.dryRun ?? false;
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
      answers: { imported: 0, unlinked: 0, questionGone: 0, unreadable: 0 },
      files: { copied: 0, notCopied: 0 },
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

      if (already.has(`${quiz.id}|${row.submission_key}`)) {
        summary.submissions.alreadyImported++;
        continue;
      }

      const answers: NewQuizAnswer[] = [];
      const unlinked: UnlinkedAnswer[] = [];
      let filesCopied = 0;
      let filesNotCopied = 0;
      for (const stored of answersFromJson(row.answers)) {
        const question = questionOfAnswer(questions, stored);
        if (!question) {
          const kept = await keepUnlinked(stored, memberId, deps, dryRun);
          if (!kept) {
            summary.answers.questionGone++;
            continue;
          }
          if (kept.fileFailed) filesNotCopied++;
          else if (kept.answer.file) filesCopied++;
          unlinked.push(kept.answer);
          summary.answers.unlinked++;
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
      const outcome = await repos.quizzes.importAttempt({ quizId: quiz.id, memberId, sourceKey: row.submission_key, submittedAt: row.submitted_at, answers, unlinked });
      if (outcome === "exists") {
        summary.submissions.alreadyImported++;
        continue;
      }
      summary.submissions.imported++;
      summary.answers.imported += answers.length;
      summary.files.copied += filesCopied;
      summary.files.notCopied += filesNotCopied;
    }
  }
  return result;
}

/**
 * An answer no question of the quiz could be matched to, kept as it was given: its position and wording, what was written or picked,
 * and its file copied into the member's own folder. Null when it has no position to be kept by (an older shape that named a question
 * that is gone) or nothing to keep.
 */
async function keepUnlinked(
  stored: StoredAnswer,
  memberId: string,
  deps: ResponseImportDeps,
  dryRun: boolean,
): Promise<{ answer: UnlinkedAnswer; fileFailed: boolean } | null> {
  if (stored.position === null || stored.position === undefined) return null;
  const text = stored.text?.trim() || null;
  const labels = stored.optionLabels;
  if (!text && labels.length === 0 && stored.optionKeys.length === 0 && !stored.file) return null;
  let file: UnlinkedAnswer["file"] = null;
  let fileFailed = false;
  if (stored.file) {
    const to = stored.file.storagePath ? newQuizFilePath(memberId, stored.file.name, deps.randomId()) : null;
    if (to && (dryRun || (await deps.copyFile(stored.file.storagePath!, to)))) file = { path: to, name: stored.file.name.slice(0, 200), bytes: Math.min(stored.file.bytes ?? 0, QUIZ_ANSWERS.maxFileBytes) };
    else fileFailed = true;
  }
  const named = kindOfTypeName(stored.questionType);
  const kind = named ?? (stored.file ? "file_upload" : labels.length > 0 || stored.optionKeys.length > 0 ? "choice" : "short_answer");
  return { answer: { position: stored.position, prompt: stored.prompt, kind, text, labels, file }, fileFailed };
}
