import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { loadAdminQuiz, loadQuizResults } from "@/lib/courses/admin-quiz";
import { tabTitle } from "@/lib/tab-routes";
import CourseBuilderBanner from "../../../CourseBuilderBanner";
import QuizLessonTabs, { QUIZ_TAB_LABELS, type QuizTab } from "./QuizLessonTabs";
import QuizQuestionsEditor from "./QuizQuestionsEditor";
import QuizResultsTable from "./QuizResultsTable";
import QuizSettingsForm from "./QuizSettingsForm";

const CARD = "rounded-lg bg-white p-6 shadow dark:bg-slate-900";

/** The browser tab's title: the lesson first ("Check In · Questions · Plot Lab · Courses"). */
export async function quizTabMetadata(idParam: string, lessonId: string, tab: Exclude<QuizTab, "details">): Promise<Metadata> {
  const quiz = await loadAdminQuiz(createRepos(await createClient()), idParam, lessonId);
  return { title: tabTitle({ record: quiz?.lesson.title, section: [quiz?.course.title, "Courses"].filter(Boolean).join(" · ") }, QUIZ_TAB_LABELS[tab], false) };
}

/**
 * One of a quiz lesson's pages (Questions, Settings, Results), behind `courses.manage`. It holds the correct answers, so it is
 * staff only: a member never loads it, and what members see of the quiz is built separately without them.
 */
export default async function QuizLessonPage({ idParam, lessonId, tab }: { idParam: string; lessonId: string; tab: Exclude<QuizTab, "details"> }) {
  await requirePermission("courses.manage");
  const repos = createRepos(await createClient());
  const quiz = await loadAdminQuiz(repos, idParam, lessonId);
  if (!quiz) notFound();
  const base = `/admin/courses/${idParam}/lessons/${lessonId}`;
  const results = tab === "results" ? await loadQuizResults(repos, quiz.quiz.id) : null;
  const graded = quiz.hasGradedQuestions && quiz.quiz.passingPercent !== null;

  return (
    <>
      {!quiz.editable && <CourseBuilderBanner />}
      <div className="@container container mx-auto max-w-4xl px-6 py-8">
        <Link href={`/admin/courses/${idParam}`} className="text-sm text-slate-600 hover:underline dark:text-slate-400">
          ← {quiz.course.title}
        </Link>
        <h1 className="mb-4 mt-2 text-3xl font-bold">{quiz.lesson.title}</h1>
        <QuizLessonTabs base={base} current={tab} />
        <div className={CARD}>
          {tab === "questions" && (
            <>
              <h2 className="mb-1 text-lg font-semibold">Questions</h2>
              <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
                {graded ? `Members need ${quiz.quiz.passingPercent}% to pass.` : "No passing grade: submitting the quiz completes the lesson."}{" "}
                {quiz.hasGradedQuestions ? (quiz.quiz.hideAnswers ? "Members don't see which answers were right." : "Members see which answers were right.") : "Nothing in it is scored."}
              </p>
              <QuizQuestionsEditor
                courseId={quiz.course.id}
                lessonId={quiz.lesson.id}
                editable={quiz.editable}
                attemptCount={quiz.attemptCount}
                questions={quiz.questions.map((q) => ({ id: q.id, prompt: q.prompt, kind: q.kind, graded: q.graded, allowsMultiple: q.allowsMultiple, options: q.options.map((o) => ({ id: o.id, label: o.label, isCorrect: o.isCorrect })) }))}
              />
            </>
          )}
          {tab === "settings" && (
            <>
              <h2 className="mb-4 text-lg font-semibold">Settings</h2>
              <QuizSettingsForm
                courseId={quiz.course.id}
                lessonId={quiz.lesson.id}
                lessonTitle={quiz.lesson.title}
                passingPercent={quiz.quiz.passingPercent}
                hideAnswers={quiz.quiz.hideAnswers}
                hasGradedQuestions={quiz.hasGradedQuestions}
                editable={quiz.editable}
                attemptCount={quiz.attemptCount}
              />
            </>
          )}
          {tab === "results" && results && (
            <>
              <h2 className="mb-4 text-lg font-semibold">Results</h2>
              <QuizResultsTable rows={results} graded={graded} base={base} canOpenAnswers={quiz.hasOpenQuestions} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
