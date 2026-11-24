import { documentsOf, importedQuizOf, parseKajabiQuiz } from "@/lib/kajabi/quiz-capture";
import type { Repos } from "@/lib/data/repos";

type QuizSyncRepos = Pick<Repos, "kajabiCourses" | "quizzes">;

/** What syncing a course's quizzes did, for the processing report (counts only, never a question). */
export interface QuizSyncSummary {
  /** Quizzes written or confirmed in Silver. */
  synced: number;
  questions: number;
  /** Imported quizzes removed because Kajabi's quiz is gone from Bronze. */
  removed: number;
  /** Quizzes whose captured documents hold no question the reading could find (they keep what Silver has; see the capture's notes). */
  unreadable: number;
  /** Captured quizzes whose lesson isn't in Silver (yet). */
  noLesson: number;
  /** Questions left out because they don't fit (too few or too many answers). */
  skippedQuestions: number;
  /** Quizzes not imported because a question is graded by hand in Kajabi (short answer, file upload): the Hub builds only choice questions. They keep what Silver has. */
  skippedManual: number;
}

/**
 * The Silver step for a Kajabi course's quizzes: for each live Bronze quiz, find its lesson (by the lesson's Kajabi id, as
 * `lessonIdBySourceKey` maps it) and make that lesson's quiz match, on Kajabi's keys (`QuizRepository.syncImportedQuiz`, one
 * transaction per quiz). A quiz Bronze no longer has live is removed from Silver, and a lesson that has become a plain lesson
 * loses it; a quiz Bronze has but can't be read is kept as it is, never removed for a failed reading. Idempotent: syncing again
 * writes no row that didn't change, and a member's attempts keep pointing at the same questions.
 */
export async function syncCourseQuizzes(repos: QuizSyncRepos, courseKajabiId: string, lessonIdBySourceKey: ReadonlyMap<string, string>): Promise<QuizSyncSummary> {
  const summary: QuizSyncSummary = { synced: 0, questions: 0, removed: 0, unreadable: 0, noLesson: 0, skippedQuestions: 0, skippedManual: 0 };
  const bronze = await repos.kajabiCourses.liveQuizzes(courseKajabiId);
  const keep: string[] = [];
  for (const row of bronze) {
    // Kept either way: a failed reading or a missing lesson is no reason to delete what members may have attempted.
    keep.push(row.kajabi_id);
    const lessonId = lessonIdBySourceKey.get(row.lesson_kajabi_id);
    if (!lessonId) {
      summary.noLesson++;
      continue;
    }
    const parsed = parseKajabiQuiz(documentsOf(row.raw_payload));
    if (!parsed) {
      summary.unreadable++;
      continue;
    }
    if (parsed.manualQuestions > 0) {
      summary.skippedManual++;
      continue;
    }
    const { quiz } = importedQuizOf(row.kajabi_id, parsed);
    summary.skippedQuestions += parsed.questions.length - quiz.questions.length;
    const result = await repos.quizzes.syncImportedQuiz(lessonId, quiz);
    if (result.status === "synced") {
      summary.synced++;
      summary.questions += result.questions;
    }
  }
  summary.removed = await repos.quizzes.removeImportedQuizzes([...lessonIdBySourceKey.values()], keep);
  return summary;
}
