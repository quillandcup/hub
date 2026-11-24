"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { prepareQuizFileUpload, submitQuiz } from "@/app/(member)/courses/quiz-actions";
import { useLessonCompletion } from "@/components/courses/LessonCompletion";
import Tooltip from "@/components/Tooltip";
import { signedUploadUrl, uploadWithProgress } from "@/lib/chat/upload-progress";
import { QUIZ_ANSWERS } from "@/lib/config";
import { formatBytes } from "@/lib/courses/file-format";
import { checkQuizFile, QUIZ_ANSWER_FILES_BUCKET, uploadTargetFrom, type UploadedFileRef } from "@/lib/courses/quiz-files";
import type { MemberAttempt, PublicQuizQuestion, QuizSubmission } from "@/lib/courses/quiz-member";

const BUTTON = "rounded-lg border-2 border-plum-600 px-6 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";
const PRIMARY = `${BUTTON} bg-plum-600 text-white hover:bg-plum-700`;
const SECONDARY = `${BUTTON} bg-white text-plum-700 hover:bg-plum-50 dark:bg-transparent dark:text-plum-300 dark:hover:bg-slate-800`;
const FIELD = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800";

const attemptDate = (iso: string, timeZone: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(iso));

/** "A, B and C" for a list of answers. */
const listOf = (labels: string[]) => (labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`);

/** The score and what it means, in one plain sentence; a quiz with nothing scored has no score, only the answers that are in. */
function resultSentence(s: QuizSubmission): string {
  if (!s.scored) return "Your answers are in and this lesson is complete.";
  const score = `You scored ${s.scorePercent}% (${s.correctCount} of ${s.questionCount}).`;
  if (s.passingPercent === null) return `${score} Your answers are in and this lesson is complete.`;
  if (s.passed) return `${score} You passed, and this lesson is complete.`;
  return `${score} You need ${s.passingPercent}% to pass. You can try again.`;
}

/** The address of one of the member's own uploaded files: the route checks it is theirs. */
const fileHref = (attemptId: string, questionId: string) => `/api/course-quiz-answers/${attemptId}/${questionId}`;

/**
 * A lesson's quiz, in the lesson page in place of the Mark complete button: the questions (choose one, choose all that apply, write
 * a short answer, upload a file), a submit button, and after submitting the score (when anything was scored) and, unless the quiz
 * hides them, which answers were right. The questions the browser gets have no right answers in them; scoring happens on the server
 * (`submitQuiz`). A pass (any submitted attempt, for a quiz with nothing to score) completes the lesson, which the lesson's
 * completion state then shows. Retaking is always allowed. What a member writes and uploads is shown only to them and to the
 * course team. Native fields, so the keyboard works as it does everywhere; the result takes focus when it appears.
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
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, UploadedFileRef>>({});
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const [submission, setSubmission] = useState<QuizSubmission | null>(null);
  const [sent, setSent] = useState<{ texts: Record<string, string>; files: Record<string, UploadedFileRef> }>({ texts: {}, files: {} });
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
      formRef.current?.querySelector<HTMLElement>("input, textarea")?.focus();
    }
  }, [submission]);

  if (questions.length === 0) {
    return <p className="rounded-lg bg-slate-100 p-4 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">This quiz has no questions yet. Check back soon.</p>;
  }

  const hasOpen = questions.some((q) => q.kind !== "choice");
  const isAnswered = (q: PublicQuizQuestion) => (q.kind === "short_answer" ? (texts[q.id] ?? "").trim() !== "" : q.kind === "file_upload" ? !!files[q.id] : (picks[q.id] ?? []).length > 0);
  const answered = questions.filter(isAnswered).length;
  const busyUploading = Object.keys(uploading).length > 0;
  const choose = (q: PublicQuizQuestion, optionId: string, checked: boolean) =>
    setPicks((current) => {
      const now = current[q.id] ?? [];
      return { ...current, [q.id]: q.allowsMultiple ? (checked ? [...now.filter((id) => id !== optionId), optionId] : now.filter((id) => id !== optionId)) : [optionId] };
    });

  const setUploadingFor = (id: string, loaded: number | null) =>
    setUploading((current) => {
      const next = { ...current };
      if (loaded === null) delete next[id];
      else next[id] = loaded;
      return next;
    });
  const fail = (id: string, message: string) => setFileErrors((current) => ({ ...current, [id]: message }));

  // The file goes straight to storage (the server made a signed address for this one path); the quiz submission then names the path.
  const upload = async (q: PublicQuizQuestion, file: File | undefined) => {
    if (!file || readOnlyReason) return;
    setFileErrors((current) => ({ ...current, [q.id]: "" }));
    const checked = checkQuizFile(file.name, file.size);
    if (!checked.ok) return fail(q.id, checked.error);
    setUploadingFor(q.id, 0);
    try {
      const prepared = await prepareQuizFileUpload(lessonId, q.id, { name: file.name, size: file.size });
      const target = prepared.error ? null : uploadTargetFrom(prepared.path, prepared.token);
      if (!target) return fail(q.id, prepared.error ?? "Couldn't start the upload. Try again.");
      const result = await uploadWithProgress({
        url: signedUploadUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!, QUIZ_ANSWER_FILES_BUCKET, target.path, target.token),
        file,
        contentType: file.type || "application/octet-stream",
        apiKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        onProgress: (loaded) => setUploadingFor(q.id, loaded),
      });
      if (!result.ok) return fail(q.id, "The upload didn't finish. Try again.");
      setFiles((current) => ({ ...current, [q.id]: { path: target.path, name: file.name, bytes: file.size } }));
    } catch {
      fail(q.id, "The upload didn't finish. Try again.");
    } finally {
      setUploadingFor(q.id, null);
    }
  };

  const submit = async () => {
    if (readOnlyReason || pending || busyUploading) return;
    setPending(true);
    setError(null);
    try {
      const result = await submitQuiz(lessonId, { picks, texts, files });
      if (result.error || !result.submission) {
        setError(result.error ?? "Couldn't save your answers. Try again.");
        return;
      }
      setSent({ texts, files });
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
    setTexts({});
    setFiles({});
    setFileErrors({});
    setSubmission(null);
    setError(null);
  };

  if (submission) {
    const label = (q: PublicQuizQuestion, ids: string[]) => listOf(q.options.filter((o) => ids.includes(o.id)).map((o) => o.label));
    const openQuestions = questions.filter((q) => q.kind !== "choice");
    return (
      <section aria-label="Quiz results">
        <div ref={resultRef} tabIndex={-1} role="status" className="rounded-xl border border-slate-200 p-5 outline-none focus-visible:ring-2 focus-visible:ring-plum-500 dark:border-slate-700">
          <h2 className="text-xl font-bold">{!submission.scored ? "Thank you" : submission.passingPercent !== null && !submission.passed ? "Not quite yet" : "Your score"}</h2>
          <p className="mt-2 text-base">{resultSentence(submission)}</p>
          {hideAnswers && submission.scored && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">This quiz doesn&apos;t show which answers were right.</p>}
        </div>

        {submission.review && submission.review.length > 0 && (
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

        {openQuestions.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold">What you wrote and uploaded</h3>
            <ul className="mt-2 space-y-3">
              {openQuestions.map((q) => (
                <li key={q.id} className="rounded-lg border border-slate-200 p-4 text-sm dark:border-slate-700">
                  <p className="font-medium">{q.prompt}</p>
                  {q.kind === "short_answer" ? (
                    <p className="mt-1 whitespace-pre-wrap text-slate-700 dark:text-slate-300">{(sent.texts[q.id] ?? "").trim() || "No answer"}</p>
                  ) : (
                    <p className="mt-1 text-slate-700 dark:text-slate-300">{sent.files[q.id]?.name ?? "No file"}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <button type="button" onClick={retake} data-track="quiz-retake" className={`${SECONDARY} mt-5 w-full`}>
          {submission.scored && submission.passingPercent !== null && !submission.passed ? "Try again" : "Take the quiz again"}
        </button>
      </section>
    );
  }

  return (
    <section aria-label="Quiz">
      <p className="text-sm text-slate-700 dark:text-slate-300">
        {passingPercent === null ? "Answer the questions and submit to complete this lesson." : `Score at least ${passingPercent}% to pass and complete this lesson. A question counts only when you choose exactly the right answers.`}
      </p>
      {hasOpen && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Only you and the course team can read what you write or upload here.</p>}
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
                {q.kind === "choice" && (
                  <>
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
                  </>
                )}
                {q.kind === "short_answer" && (
                  <label className="block text-sm">
                    <span className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Your answer</span>
                    <textarea
                      value={texts[q.id] ?? ""}
                      onChange={(e) => setTexts((current) => ({ ...current, [q.id]: e.target.value }))}
                      maxLength={QUIZ_ANSWERS.maxTextChars}
                      rows={4}
                      disabled={!!readOnlyReason}
                      className={FIELD}
                    />
                  </label>
                )}
                {q.kind === "file_upload" && (
                  <div className="text-sm">
                    <p className="mb-2 text-xs text-slate-600 dark:text-slate-400">Upload one file, up to {QUIZ_ANSWERS.maxFileBytes / (1024 * 1024)} MB.</p>
                    {files[q.id] ? (
                      <p className="flex flex-wrap items-center gap-3">
                        <span>
                          {files[q.id].name} <span className="text-slate-600 dark:text-slate-400">({formatBytes(files[q.id].bytes)})</span>
                        </span>
                        <button type="button" disabled={!!readOnlyReason} onClick={() => setFiles((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== q.id)))} className="text-plum-700 underline disabled:opacity-60 dark:text-plum-300">
                          Remove file
                        </button>
                      </p>
                    ) : (
                      <input
                        type="file"
                        aria-label={`File for question ${i + 1}`}
                        accept={QUIZ_ANSWERS.fileExtensions.map((e) => `.${e}`).join(",")}
                        disabled={!!readOnlyReason || q.id in uploading}
                        onChange={(e) => {
                          void upload(q, e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                    )}
                    {q.id in uploading && (
                      <p role="status" className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                        Uploading…
                      </p>
                    )}
                    {fileErrors[q.id] && (
                      <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
                        {fileErrors[q.id]}
                      </p>
                    )}
                  </div>
                )}
              </fieldset>
            </li>
          ))}
        </ol>

        <p className="mt-4 text-sm text-slate-600 dark:text-slate-400" aria-live="polite">
          {answered} of {questions.length} answered
        </p>
        <div className="mt-3">
          <Tooltip content={readOnlyReason ?? undefined}>
            <button type="submit" disabled={!!readOnlyReason || pending || busyUploading} data-track="quiz-submit" className={`${PRIMARY} w-full`}>
              {pending ? "Submitting…" : busyUploading ? "Uploading…" : "Submit answers"}
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
          <ul className="mt-2 space-y-2 text-sm text-slate-700 dark:text-slate-300">
            {attempts.map((a) => (
              <li key={a.id}>
                {attemptDate(a.submittedAt, timeZone)}
                {a.questionCount > 0 ? `: ${a.scorePercent}% (${a.correctCount} of ${a.questionCount})${passingPercent !== null ? (a.passed ? ", passed" : ", not passed") : ""}` : ": submitted"}
                {a.importedFrom === "kajabi" && " (from Kajabi)"}
                {a.openAnswers.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-plum-700 dark:text-plum-300">What you wrote and uploaded</summary>
                    <ul className="mt-2 space-y-2 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                      {a.openAnswers.map((o) => (
                        <li key={o.questionId}>
                          <p className="font-medium">{o.prompt ?? questions.find((q) => q.id === o.questionId)?.prompt ?? "A question that is no longer in this quiz"}</p>
                          {o.text !== null && <p className="whitespace-pre-wrap">{o.text}</p>}
                          {o.fileName !== null && (
                            <a href={fileHref(a.id, o.questionId)} className="text-plum-700 underline dark:text-plum-300">
                              {o.fileName}
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
