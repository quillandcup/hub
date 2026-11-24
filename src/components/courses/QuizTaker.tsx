"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { submitQuiz } from "@/app/(member)/courses/quiz-actions";
import { useLessonCompletion } from "@/components/courses/LessonCompletion";
import Tooltip from "@/components/Tooltip";
import type { MemberAttempt, PublicQuizQuestion, QuizSubmission } from "@/lib/courses/quiz-member";

const BUTTON = "rounded-lg border-2 border-plum-600 px-6 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";
const PRIMARY = `${BUTTON} bg-plum-600 text-white hover:bg-plum-700`;
const SECONDARY = `${BUTTON} bg-white text-plum-700 hover:bg-plum-50 dark:bg-transparent dark:text-plum-300 dark:hover:bg-slate-800`;

const attemptDate = (iso: string, timeZone: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(iso));

/** "A, B and C" for a list of answers. */
const listOf = (labels: string[]) => (labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`);

/** The score and what it means, in one plain sentence. */
function resultSentence(s: QuizSubmission): string {
  const score = `You scored ${s.scorePercent}% (${s.correctCount} of ${s.questionCount}).`;
  if (s.passingPercent === null) return `${score} Your answers are in and this lesson is complete.`;
  if (s.passed) return `${score} You passed, and this lesson is complete.`;
  return `${score} You need ${s.passingPercent}% to pass. You can try again.`;
}

/**
 * A lesson's quiz, in the lesson page in place of the Mark complete button: the questions (choose one, or choose all that apply),
 * a submit button, and after submitting the score and, unless the quiz hides them, which answers were right. The questions the
 * browser gets have no right answers in them; scoring happens on the server (`submitQuiz`). A pass (or any attempt at a quiz
 * with no passing grade) completes the lesson, which the lesson's completion state then shows. Retaking is always allowed.
 * Native radio buttons and checkboxes, so the keyboard works as it does everywhere; the score takes focus when it appears.
 */
export default function QuizTaker({
  lessonId,
  questions,
  passingPercent,
  hideAnswers,
  attempts,
  passedBefore,
  readOnlyReason,
  timeZone,
}: {
  lessonId: string;
  questions: PublicQuizQuestion[];
  passingPercent: number | null;
  hideAnswers: boolean;
  attempts: MemberAttempt[];
  passedBefore: boolean;
  readOnlyReason: string | null;
  timeZone: string;
}) {
  const router = useRouter();
  const completion = useLessonCompletion();
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [submission, setSubmission] = useState<QuizSubmission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const retaking = useRef(false);

  // The score takes focus when it appears, and the first question when the form comes back, so a keyboard or screen reader user is never left behind.
  useEffect(() => {
    if (submission) resultRef.current?.focus();
    else if (retaking.current) {
      retaking.current = false;
      formRef.current?.querySelector<HTMLElement>("input")?.focus();
    }
  }, [submission]);

  if (questions.length === 0) {
    return <p className="rounded-lg bg-slate-100 p-4 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">This quiz has no questions yet. Check back soon.</p>;
  }

  const answered = questions.filter((q) => (picks[q.id] ?? []).length > 0).length;
  const choose = (q: PublicQuizQuestion, optionId: string, checked: boolean) =>
    setPicks((current) => {
      const now = current[q.id] ?? [];
      return { ...current, [q.id]: q.allowsMultiple ? (checked ? [...now.filter((id) => id !== optionId), optionId] : now.filter((id) => id !== optionId)) : [optionId] };
    });

  const submit = async () => {
    if (readOnlyReason || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await submitQuiz(lessonId, picks);
      if (result.error || !result.submission) {
        setError(result.error ?? "Couldn't save your answers. Try again.");
        return;
      }
      setSubmission(result.submission);
      if (result.submission.lessonComplete) completion?.markCompleted();
      router.refresh();
    } catch {
      setError("Couldn't save your answers. Try again.");
    } finally {
      setPending(false);
    }
  };

  const retake = () => {
    retaking.current = true;
    setPicks({});
    setSubmission(null);
    setError(null);
  };

  if (submission) {
    const label = (q: PublicQuizQuestion, ids: string[]) => listOf(q.options.filter((o) => ids.includes(o.id)).map((o) => o.label));
    return (
      <section aria-label="Quiz results">
        <div ref={resultRef} tabIndex={-1} role="status" className="rounded-xl border border-slate-200 p-5 outline-none focus-visible:ring-2 focus-visible:ring-plum-500 dark:border-slate-700">
          <h2 className="text-xl font-bold">{submission.passingPercent !== null && !submission.passed ? "Not quite yet" : "Your score"}</h2>
          <p className="mt-2 text-base">{resultSentence(submission)}</p>
          {hideAnswers && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">This quiz doesn&apos;t show which answers were right.</p>}
        </div>

        {submission.review && (
          <ol className="mt-4 space-y-4">
            {questions.map((q, i) => {
              const item = submission.review!.find((r) => r.questionId === q.id);
              if (!item) return null;
              return (
                <li key={q.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                  <p className="font-medium">
                    <span className="mr-2 text-slate-500">{i + 1}.</span>
                    {q.prompt}
                  </p>
                  <p className="mt-1 text-sm font-semibold">{item.correct === null ? "Not scored" : item.correct ? "Right" : "Not quite"}</p>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">Your answer: {item.selectedOptionIds.length > 0 ? label(q, item.selectedOptionIds) : "none"}</p>
                  {item.correct === false && <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">Right {item.correctOptionIds.length === 1 ? "answer" : "answers"}: {label(q, item.correctOptionIds)}</p>}
                </li>
              );
            })}
          </ol>
        )}

        <button type="button" onClick={retake} data-track="quiz-retake" className={`${SECONDARY} mt-5 w-full`}>
          {submission.passingPercent !== null && !submission.passed ? "Try again" : "Take the quiz again"}
        </button>
      </section>
    );
  }

  return (
    <section aria-label="Quiz">
      <p className="text-sm text-slate-700 dark:text-slate-300">
        {passingPercent === null ? "Answer the questions and submit to complete this lesson." : `Score at least ${passingPercent}% to pass and complete this lesson. A question counts only when you choose exactly the right answers.`}
      </p>
      {passedBefore && <p className="mt-2 text-sm font-medium text-green-800 dark:text-green-300">You&apos;ve passed this quiz. You can take it again; the lesson stays complete.</p>}

      <form
        ref={formRef}
        aria-label="Quiz questions"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="mt-4"
      >
        <ol className="space-y-5">
          {questions.map((q, i) => (
            <li key={q.id}>
              <fieldset className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                <legend className="px-1 font-medium">
                  <span className="mr-2 text-slate-500">{i + 1}.</span>
                  {q.prompt}
                </legend>
                <p className="mb-2 text-xs text-slate-600 dark:text-slate-400">{q.allowsMultiple ? "Choose all that apply" : "Choose one"}</p>
                <div className="space-y-1">
                  {q.options.map((o) => (
                    <label key={o.id} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                      <input
                        type={q.allowsMultiple ? "checkbox" : "radio"}
                        name={q.id}
                        value={o.id}
                        checked={(picks[q.id] ?? []).includes(o.id)}
                        disabled={!!readOnlyReason}
                        onChange={(e) => choose(q, o.id, e.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0"
                      />
                      <span>{o.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </li>
          ))}
        </ol>

        <p className="mt-4 text-sm text-slate-600 dark:text-slate-400" aria-live="polite">
          {answered} of {questions.length} answered
        </p>
        <div className="mt-3">
          <Tooltip content={readOnlyReason ?? undefined}>
            <button type="submit" disabled={!!readOnlyReason || pending} data-track="quiz-submit" className={`${PRIMARY} w-full`}>
              {pending ? "Submitting…" : "Submit answers"}
            </button>
          </Tooltip>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </form>

      {attempts.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold">Your earlier attempts</h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
            {attempts.map((a) => (
              <li key={a.id}>
                {attemptDate(a.submittedAt, timeZone)}: {a.scorePercent}% ({a.correctCount} of {a.questionCount}){passingPercent !== null && (a.passed ? ", passed" : ", not passed")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
