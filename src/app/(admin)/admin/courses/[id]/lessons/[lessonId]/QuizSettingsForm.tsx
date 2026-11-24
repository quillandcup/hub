"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";
import { parsePassingPercent } from "@/lib/courses/quiz-editor";
import { removeQuiz, saveQuizSettings } from "../../../quiz-actions";

const FIELD = "w-24 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800";
const PRIMARY = "rounded bg-plum-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-plum-700 disabled:cursor-not-allowed disabled:opacity-60";
const DEFAULT_PASSING = "70";

/**
 * The Settings tab: an optional passing grade (a quiz with none is not graded, so any submitted attempt completes the lesson), whether
 * members see which answers were right, and taking the quiz off the lesson. Shown disabled for a quiz imported from Kajabi.
 */
export default function QuizSettingsForm({
  courseId,
  lessonId,
  lessonTitle,
  passingPercent,
  hideAnswers,
  editable,
  attemptCount,
}: {
  courseId: string;
  lessonId: string;
  lessonTitle: string;
  passingPercent: number | null;
  hideAnswers: boolean;
  editable: boolean;
  attemptCount: number;
}) {
  const router = useRouter();
  const [graded, setGraded] = useState(passingPercent !== null);
  const [percent, setPercent] = useState(passingPercent === null ? DEFAULT_PASSING : String(passingPercent));
  const [hide, setHide] = useState(hideAnswers);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [removing, setRemoving] = useState(false);

  const save = async () => {
    const typed = graded ? percent : "";
    const checked = parsePassingPercent(typed);
    if (!checked.ok) return setMessage({ ok: false, text: checked.error });
    if (graded && checked.passingPercent === null) return setMessage({ ok: false, text: "Use a whole number from 1 to 100." });
    setBusy(true);
    setMessage(null);
    const result = await saveQuizSettings(courseId, lessonId, { passingPercent: typed, hideAnswers: hide });
    setBusy(false);
    if (result.error) return setMessage({ ok: false, text: result.error });
    setMessage({ ok: true, text: "Settings saved." });
    router.refresh();
  };

  return (
    <div className="space-y-8">
      <form
        aria-label="Quiz settings"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-5"
      >
        <fieldset disabled={!editable || busy} className="space-y-5">
          <div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={graded} onChange={(e) => setGraded(e.target.checked)} />
              Set a passing grade
            </label>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {graded
                ? "Members complete the lesson only when they pass. They can retake the quiz as often as they like."
                : "Without a passing grade the quiz isn't graded: submitting it completes the lesson, whatever the score."}
            </p>
            {graded && (
              <label className="mt-2 flex items-center gap-2 text-sm">
                <span>Passing grade</span>
                <input type="text" inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value)} className={FIELD} aria-describedby="quiz-passing-hint" />
                <span aria-hidden="true">%</span>
              </label>
            )}
            {graded && (
              <p id="quiz-passing-hint" className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                The share of questions a member must get fully right. A question is right only when they choose exactly the right answers.
              </p>
            )}
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} />
              Hide answers on the results page
            </label>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Members see their score but not which answers were right.</p>
          </div>
        </fieldset>

        {editable && (
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy} className={PRIMARY}>
              {busy ? "Saving…" : "Save settings"}
            </button>
            {message && (
              <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-green-800 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}>
                {message.text}
              </p>
            )}
          </div>
        )}
      </form>

      {editable && (
        <section aria-labelledby="quiz-remove" className="border-t border-slate-200 pt-6 dark:border-slate-700">
          <h2 id="quiz-remove" className="text-base font-semibold">
            Remove the quiz
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">The lesson stays, without its questions. Use Delete lesson on the Details tab to remove the whole lesson.</p>
          <button type="button" onClick={() => setRemoving(true)} className="mt-3 text-sm font-medium text-red-700 hover:underline dark:text-red-300">
            Remove quiz
          </button>
        </section>
      )}

      {removing && (
        <ConfirmDialog
          open
          onClose={() => setRemoving(false)}
          onConfirm={async () => {
            const result = await removeQuiz(courseId, lessonId);
            if (result.error) return result.error;
            router.push(`/admin/courses/${courseId}/lessons/${lessonId}`);
            router.refresh();
          }}
          title="Remove the quiz?"
          body={`“${lessonTitle}” becomes a plain lesson. Its questions are deleted${attemptCount > 0 ? `, and so are the ${attemptCount} ${attemptCount === 1 ? "attempt" : "attempts"} members made` : ""}. This can't be undone.`}
          confirmLabel="Remove quiz"
          tone="danger"
        />
      )}
    </div>
  );
}
