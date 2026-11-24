import type { Repos } from "@/lib/data/repos";

/**
 * Duplicating a lesson, a module or a course copies lessons row by row and does not know quizzes (`docs/TODO.md`, "Quizzes:
 * duplicating a lesson, module or course drops the quiz"), so a copy would hold a quiz lesson with no questions. Until the
 * copy functions carry the quiz, the actions refuse: this says why, or null when nothing in the lessons is a quiz.
 */
export async function duplicateBlockedByQuizzes(repos: Pick<Repos, "quizzes">, lessonIds: string[], what: "lesson" | "module" | "course"): Promise<string | null> {
  if (lessonIds.length === 0) return null;
  const quizzes = (await repos.quizzes.quizzesOfLessons(lessonIds)).size;
  if (quizzes === 0) return null;
  if (what === "lesson") return "A quiz can't be duplicated yet. Make a new quiz and copy its questions by hand.";
  return `This ${what} holds ${quizzes === 1 ? "a quiz" : `${quizzes} quizzes`}, and a copy would leave ${quizzes === 1 ? "it" : "them"} empty, so it can't be duplicated yet.`;
}
