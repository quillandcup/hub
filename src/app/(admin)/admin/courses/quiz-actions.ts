"use server";

import { revalidatePath } from "next/cache";
import { requireActionPermission } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { CourseWriteError } from "@/lib/data/courses";
import { QuizWriteError } from "@/lib/data/quizzes";
import { createRepos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";
import { parseItemTitle } from "@/lib/courses/editor";
import { checkQuestion, isQuestionId, parsePassingPercent, type QuestionDraft } from "@/lib/courses/quiz-editor";
import { removeQuizFiles } from "@/lib/courses/quiz-files-storage";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * The quiz builder's writes: make a quiz lesson, save, delete and reorder its questions, change its settings, take the quiz off a
 * lesson. Each runs as the signed-in admin with their own client, so the database policies decide what they may touch (never a
 * quiz of a course imported from Kajabi) and the audit log names them: one entry on the quiz (migration 20271124000000). The
 * client names the lesson (its address), never the quiz: the quiz is looked up from it and checked to be in the course.
 */

type Auth = Extract<Awaited<ReturnType<typeof requireActionPermission>>, { ok: true }>;
export type QuizResult = { error?: string; id?: string };

const NOT_EDITABLE = "That quiz can't be edited here: it isn't in the Hub, or it's imported from Kajabi.";
const NOT_FOUND = "That has been deleted. Refresh the page.";

/** What a refusal means for the person editing, in their words. */
function describe(error: unknown, what: string): string {
  const code = error instanceof QuizWriteError || error instanceof CourseWriteError ? error.code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (code === "42501" || /row-level security/i.test(message)) return NOT_EDITABLE;
  if (code === "not_found" || message === "not_found") return NOT_FOUND;
  if (code === "stale_order" || message === "stale_order") return "The questions changed since you opened this page. Refresh the page and try again.";
  if (code === "invalid_question" || message === "invalid_question") return "That question isn't complete: it needs a prompt, and a multiple choice question needs two or more answers and, when graded, a right answer.";
  if (code === "23505") return "That lesson is already a quiz.";
  console.error(`course quiz: ${what} failed:`, message);
  return `Couldn't ${what}.`;
}

function revalidate(courseId: string, lessonId: string) {
  revalidatePath(`/admin/courses/${courseId}`, "layout");
  revalidatePath(`/admin/courses/${courseId}/lessons/${lessonId}`, "layout");
  revalidatePath("/courses", "layout");
}

/** The quiz of a lesson of this course, or why not. */
async function quizOf(auth: Auth, courseId: string, lessonId: string) {
  if (!isId(courseId, "crs") || !isId(lessonId, "les")) return { error: "Not found." } as const;
  const repos = createRepos(auth.supabase);
  const lesson = await repos.courses.lessonById(lessonId);
  if (!lesson || lesson.course_id !== courseId) return { error: "Not found." } as const;
  // A quiz imported from Kajabi is read only until its course is taken over (the lesson's source flips then).
  if (lesson.source !== "hub") return { error: NOT_EDITABLE } as const;
  const quiz = await repos.quizzes.quizOfLesson(lessonId);
  if (!quiz) return { error: "That lesson isn't a quiz." } as const;
  return { repos, quiz, lesson } as const;
}

async function addQuizImpl(auth: Auth, courseId: string, moduleId: string, title: string): Promise<QuizResult> {
  if (!isId(courseId, "crs") || !isId(moduleId, "mod")) return { error: "Course not found." };
  const name = parseItemTitle(title);
  if (!name.ok) return { error: name.error };

  const repos = createRepos(auth.supabase);
  let lessonId: string | null = null;
  try {
    const position = await repos.courses.nextPosition("lesson", courseId, moduleId);
    // A new lesson is a draft, like every new item: nothing goes live until someone publishes it.
    lessonId = await repos.courses.addLesson({ course_id: courseId, module_id: moduleId, title: name.title, position, publishing_option: "draft", source: "hub" });
    await repos.quizzes.createQuiz(lessonId);
  } catch (error) {
    // A lesson without its quiz would be a plain lesson nobody asked for: take it back.
    if (lessonId) await repos.courses.deleteItem("lesson", { id: lessonId, courseId }).catch(() => undefined);
    return { error: describe(error, "add the quiz") };
  }
  revalidate(courseId, lessonId);
  return { id: lessonId };
}

async function saveQuestionImpl(auth: Auth, courseId: string, lessonId: string, questionId: string | null, draft: QuestionDraft): Promise<QuizResult> {
  if (questionId !== null && !isQuestionId(questionId)) return { error: "Not found." };
  const found = await quizOf(auth, courseId, lessonId);
  if ("error" in found) return found;
  const checked = checkQuestion(draft);
  if (!checked.ok) return { error: checked.error };
  try {
    const id = await found.repos.quizzes.saveQuestion(found.quiz.id, questionId, checked.input);
    revalidate(courseId, lessonId);
    return { id };
  } catch (error) {
    return { error: describe(error, "save the question") };
  }
}

async function deleteQuestionImpl(auth: Auth, courseId: string, lessonId: string, questionId: string): Promise<QuizResult> {
  if (!isQuestionId(questionId)) return { error: "Not found." };
  const found = await quizOf(auth, courseId, lessonId);
  if ("error" in found) return found;
  // The files members uploaded to it go with it: found first, deleted once the question is gone.
  const files = await found.repos.quizzes.answerFilePathsOfQuestions([questionId]).catch(() => []);
  try {
    await found.repos.quizzes.deleteQuestion(found.quiz.id, questionId);
  } catch (error) {
    return { error: describe(error, "delete the question") };
  }
  await removeQuizFiles(createServiceRoleClient(), files);
  revalidate(courseId, lessonId);
  return { id: questionId };
}

const MAX_QUESTIONS = 500;

async function reorderQuestionsImpl(auth: Auth, courseId: string, lessonId: string, orderedIds: string[]): Promise<QuizResult> {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0 || orderedIds.length > MAX_QUESTIONS || !orderedIds.every((id) => isQuestionId(id))) return { error: "Not found." };
  const found = await quizOf(auth, courseId, lessonId);
  if ("error" in found) return found;
  try {
    await found.repos.quizzes.reorderQuestions(found.quiz.id, orderedIds);
  } catch (error) {
    return { error: describe(error, "reorder the questions") };
  }
  revalidate(courseId, lessonId);
  return { id: lessonId };
}

async function saveSettingsImpl(auth: Auth, courseId: string, lessonId: string, settings: { passingPercent: string; hideAnswers: boolean }): Promise<QuizResult> {
  const found = await quizOf(auth, courseId, lessonId);
  if ("error" in found) return found;
  const passing = parsePassingPercent(typeof settings?.passingPercent === "string" ? settings.passingPercent : "");
  if (!passing.ok) return { error: passing.error };
  try {
    await found.repos.quizzes.updateSettings(found.quiz.id, { passingPercent: passing.passingPercent, hideAnswers: settings.hideAnswers === true });
  } catch (error) {
    return { error: describe(error, "save the settings") };
  }
  revalidate(courseId, lessonId);
  return { id: lessonId };
}

async function removeQuizImpl(auth: Auth, courseId: string, lessonId: string): Promise<QuizResult> {
  const found = await quizOf(auth, courseId, lessonId);
  if ("error" in found) return found;
  // Every member's uploaded files go with the quiz: found first, deleted once the quiz is gone.
  const questions = await found.repos.quizzes.questionsOf(found.quiz.id).catch(() => []);
  const files = await found.repos.quizzes.answerFilePathsOfQuestions(questions.filter((q) => q.kind === "file_upload").map((q) => q.id)).catch(() => []);
  try {
    await found.repos.quizzes.deleteQuiz(found.quiz.id);
  } catch (error) {
    return { error: describe(error, "remove the quiz") };
  }
  await removeQuizFiles(createServiceRoleClient(), files);
  revalidate(courseId, lessonId);
  return { id: lessonId };
}

// Usage analytics: each action records whether it worked (src/lib/analytics/server.ts).

/** Adds a lesson that is a quiz (a draft, no questions yet) to a module of a Hub-owned course; returns the lesson's id. */
export async function addQuizLesson(courseId: string, moduleId: string, title: string): Promise<QuizResult> {
  const auth = await requireActionPermission("courses.manage");
  if (!auth.ok) return { error: auth.error };
  return withAction("course_quiz_added", () => addQuizImpl(auth, courseId, moduleId, title));
}

/** Saves one question of a lesson's quiz whole (a new one when `questionId` is null) and returns its id. */
export async function saveQuizQuestion(courseId: string, lessonId: string, questionId: string | null, draft: QuestionDraft): Promise<QuizResult> {
  const auth = await requireActionPermission("courses.manage");
  if (!auth.ok) return { error: auth.error };
  return withAction("course_quiz_question_saved", () => saveQuestionImpl(auth, courseId, lessonId, questionId, draft));
}

export async function deleteQuizQuestion(courseId: string, lessonId: string, questionId: string): Promise<QuizResult> {
  const auth = await requireActionPermission("courses.manage");
  if (!auth.ok) return { error: auth.error };
  return withAction("course_quiz_question_deleted", () => deleteQuestionImpl(auth, courseId, lessonId, questionId));
}

export async function reorderQuizQuestions(courseId: string, lessonId: string, orderedIds: string[]): Promise<QuizResult> {
  const auth = await requireActionPermission("courses.manage");
  if (!auth.ok) return { error: auth.error };
  return withAction("course_quiz_questions_reordered", () => reorderQuestionsImpl(auth, courseId, lessonId, orderedIds));
}

/** The passing grade (empty: not graded) and whether members see which answers were right. */
export async function saveQuizSettings(courseId: string, lessonId: string, settings: { passingPercent: string; hideAnswers: boolean }): Promise<QuizResult> {
  const auth = await requireActionPermission("courses.manage");
  if (!auth.ok) return { error: auth.error };
  return withAction("course_quiz_settings_saved", () => saveSettingsImpl(auth, courseId, lessonId, settings));
}

/** Takes the quiz off the lesson (its questions and every attempt go with it); the lesson stays, as a plain one. */
export async function removeQuiz(courseId: string, lessonId: string): Promise<QuizResult> {
  const auth = await requireActionPermission("courses.manage");
  if (!auth.ok) return { error: auth.error };
  return withAction("course_quiz_removed", () => removeQuizImpl(auth, courseId, lessonId));
}
