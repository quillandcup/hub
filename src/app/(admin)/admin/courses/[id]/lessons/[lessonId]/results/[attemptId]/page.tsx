import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/admin-auth";
import { loadAdminQuiz, loadAttemptView } from "@/lib/courses/admin-quiz";
import { formatCourseDateTime } from "@/lib/courses/format";
import { formatBytes } from "@/lib/courses/file-format";
import { isAttemptId } from "@/lib/courses/quiz-files";
import { createRepos } from "@/lib/data/repos";
import { createClient } from "@/lib/supabase/server";
import { tabTitle } from "@/lib/tab-routes";

type Params = { params: Promise<{ id: string; lessonId: string; attemptId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id, lessonId } = await params;
  const quiz = await loadAdminQuiz(createRepos(await createClient()), id, lessonId);
  return { title: tabTitle({ record: quiz?.lesson.title, section: [quiz?.course.title, "Courses"].filter(Boolean).join(" · ") }, "Answers", false) };
}

/**
 * One member's attempt at a quiz with everything they answered: the options they picked, the words they wrote and the files they
 * uploaded. It is the member's own writing, so it is for staff who manage courses only (and the member, in the lesson page); the
 * database policies and the file route say the same. Opening it writes nothing and records nothing.
 */
export default async function QuizAttemptPage({ params }: Params) {
  await requirePermission("courses.manage");
  const { id, lessonId, attemptId } = await params;
  if (!isAttemptId(attemptId)) notFound();
  const repos = createRepos(await createClient());
  const quiz = await loadAdminQuiz(repos, id, lessonId);
  if (!quiz) notFound();
  const view = await loadAttemptView(repos, quiz.quiz.id, attemptId);
  if (!view) notFound();
  const base = `/admin/courses/${id}/lessons/${lessonId}`;

  return (
    <div className="@container container mx-auto max-w-4xl px-6 py-8">
      <Link href={`${base}/results`} className="text-sm text-slate-600 hover:underline dark:text-slate-400">
        ← Results of {quiz.lesson.title}
      </Link>
      <h1 className="mb-1 mt-2 text-3xl font-bold">
        <Link href={`/admin/members/${view.result.memberId}`} className="hover:underline">
          {view.result.name}
        </Link>
      </h1>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
        Submitted {formatCourseDateTime(view.result.submittedAt)}.{" "}
        {view.result.questionCount === 0 ? "Nothing in this attempt was scored." : `Score ${view.result.scorePercent}% (${view.result.correctCount} of ${view.result.questionCount}).`}
        {view.result.importedFrom === "kajabi" && " Imported from Kajabi, with the questions worded as they were when it was answered."}
      </p>
      <ol className="space-y-4 rounded-lg bg-white p-6 shadow dark:bg-slate-900">
        {view.answers.map((a, i) => (
          <li key={a.questionId} className="border-b border-slate-100 pb-4 last:border-0 last:pb-0 dark:border-slate-800">
            <p className="font-medium">
              <span className="mr-2 text-slate-500">{i + 1}.</span>
              {a.prompt}
            </p>
            {a.kind === "short_answer" && <p className="mt-2 whitespace-pre-wrap text-sm">{a.text ?? <span className="text-slate-600 dark:text-slate-400">No answer</span>}</p>}
            {a.kind === "file_upload" &&
              (a.file ? (
                <p className="mt-2 text-sm">
                  <a href={`/api/course-quiz-answers/${attemptId}/${a.questionId}`} className="font-medium text-plum-700 underline dark:text-plum-300">
                    {a.file.name}
                  </a>{" "}
                  <span className="text-slate-600 dark:text-slate-400">({formatBytes(a.file.bytes)})</span>
                </p>
              ) : (
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">No file</p>
              ))}
            {a.kind === "choice" && (
              <p className="mt-2 text-sm">
                {a.picked.length > 0 ? a.picked.join(", ") : <span className="text-slate-600 dark:text-slate-400">No answer</span>}
                <span className="ml-2 text-slate-600 dark:text-slate-400">{a.correct === null ? "(not scored)" : a.correct ? "(right)" : "(not right)"}</span>
              </p>
            )}
          </li>
        ))}
      </ol>
      {view.unlinked.length > 0 && (
        <section aria-labelledby="unlinked" className="mt-6 rounded-lg bg-white p-6 shadow dark:bg-slate-900">
          <h2 id="unlinked" className="text-lg font-semibold">
            Answers to questions that no longer match
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            The quiz was edited after these were given, so they can&apos;t be tied to a question as it is now. They are kept with the wording they were given under.
          </p>
          <ul className="mt-4 space-y-4">
            {view.unlinked.map((u) => (
              <li key={u.position} className="border-b border-slate-100 pb-4 last:border-0 last:pb-0 dark:border-slate-800">
                <p className="font-medium">
                  <span className="mr-2 text-slate-500">{u.position}.</span>
                  {u.prompt ?? "A question without its wording"}
                </p>
                {u.text && <p className="mt-2 whitespace-pre-wrap text-sm">{u.text}</p>}
                {u.labels.length > 0 && <p className="mt-2 text-sm">{u.labels.join(", ")}</p>}
                {u.file && (
                  <p className="mt-2 text-sm">
                    <a href={`/api/course-quiz-answers/${attemptId}/pos_${u.position}`} className="font-medium text-plum-700 underline dark:text-plum-300">
                      {u.file.name}
                    </a>{" "}
                    <span className="text-slate-600 dark:text-slate-400">({formatBytes(u.file.bytes)})</span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
