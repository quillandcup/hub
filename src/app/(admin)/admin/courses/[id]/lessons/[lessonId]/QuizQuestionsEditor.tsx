"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import ActionMenu from "@/components/ActionMenu";
import ConfirmDialog from "@/components/ConfirmDialog";
import Icon from "@/components/Icon";
import { lifecycleConfirm, lifecycleIcon, lifecycleLabel } from "@/lib/lifecycle-actions";
import { moveToPosition, positionItems, positionsHeading } from "@/lib/reorder";
import { blankQuestion, checkQuestion, markCorrect, QUIZ_LIMITS, withAllowsMultiple, type QuestionDraft } from "@/lib/courses/quiz-editor";
import { deleteQuizQuestion, reorderQuizQuestions, saveQuizQuestion } from "../../../quiz-actions";

/** One question as the editor shows it (the correct answers are staff-only, so this page never reaches a member). */
export interface EditorQuestion {
  id: string;
  prompt: string;
  allowsMultiple: boolean;
  options: { id: string; label: string; isCorrect: boolean }[];
}

const FIELD = "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800";
const BUTTON = "rounded border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600";
const PRIMARY = "rounded bg-plum-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-plum-700 disabled:cursor-not-allowed disabled:opacity-60";
const ICON_BUTTON = "flex items-center rounded p-1.5 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-300 dark:hover:bg-slate-800";

const draftOf = (q: EditorQuestion): QuestionDraft => ({ prompt: q.prompt, allowsMultiple: q.allowsMultiple, options: q.options.map((o) => ({ id: o.id, label: o.label, isCorrect: o.isCorrect })) });

/** A question's form: its text, whether several answers may be chosen, and the answers with the right ones marked. */
function QuestionForm({ initial, label, busy, error, onSave, onCancel }: { initial: QuestionDraft; label: string; busy: boolean; error: string | null; onSave: (draft: QuestionDraft) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const ids = useId();
  const multiple = draft.allowsMultiple;
  const setLabel = (i: number, text: string) => setDraft({ ...draft, options: draft.options.map((o, j) => (j === i ? { ...o, label: text } : o)) });
  const submit = () => {
    const checked = checkQuestion(draft);
    if (!checked.ok) return setProblem(checked.error);
    setProblem(null);
    onSave(draft);
  };
  const shown = problem ?? error;

  return (
    <form
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4 rounded-lg border border-plum-300 bg-white p-4 dark:border-plum-700 dark:bg-slate-900"
    >
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Question</span>
        <textarea value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} rows={2} maxLength={QUIZ_LIMITS.prompt} className={FIELD} />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={multiple} onChange={(e) => setDraft(withAllowsMultiple(draft, e.target.checked))} />
        Members can choose more than one answer
      </label>

      <fieldset>
        <legend className="mb-1 text-sm font-medium">Answers</legend>
        <p className="mb-2 text-xs text-slate-600 dark:text-slate-400">{multiple ? "Tick every right answer. A member is right only when they choose exactly those." : "Choose the one right answer."}</p>
        <ul className="space-y-2">
          {draft.options.map((o, i) => (
            <li key={o.id ?? `new-${i}`} className="flex items-center gap-2">
              <input
                type={multiple ? "checkbox" : "radio"}
                name={`${ids}-correct`}
                checked={o.isCorrect}
                onChange={(e) => setDraft(markCorrect(draft, i, multiple ? e.target.checked : true))}
                aria-label={`Answer ${i + 1} is right`}
              />
              <input type="text" value={o.label} onChange={(e) => setLabel(i, e.target.value)} maxLength={QUIZ_LIMITS.option} aria-label={`Answer ${i + 1}`} className={FIELD} />
              <button
                type="button"
                aria-label={`Remove answer ${i + 1}`}
                disabled={draft.options.length <= QUIZ_LIMITS.optionsMin}
                onClick={() => setDraft({ ...draft, options: draft.options.filter((_, j) => j !== i) })}
                className={ICON_BUTTON}
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
        <button type="button" disabled={draft.options.length >= QUIZ_LIMITS.optionsMax} onClick={() => setDraft({ ...draft, options: [...draft.options, { label: "", isCorrect: false }] })} className={`${BUTTON} mt-2 inline-flex items-center gap-1`}>
          <Icon name="plus" />
          Add answer
        </button>
      </fieldset>

      {shown && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {shown}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={PRIMARY}>
          {busy ? "Saving…" : "Save question"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={BUTTON}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** A saved question, read only: its answers with the right ones marked in words, not only by color. */
function QuestionView({ question, number }: { question: EditorQuestion; number: number }) {
  return (
    <div>
      <p className="font-medium">
        <span className="mr-2 text-slate-500">{number}.</span>
        {question.prompt}
      </p>
      <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{question.allowsMultiple ? "Choose all that apply" : "Choose one"}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {question.options.map((o) => (
          <li key={o.id} className="flex items-center gap-2">
            <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${o.isCorrect ? "bg-green-600" : "border border-slate-400"}`} />
            <span className={o.isCorrect ? "font-medium" : undefined}>{o.label}</span>
            {o.isCorrect && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300">Right answer</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The Questions tab: the quiz's questions in order, each with its answers and the right ones marked, and the form to add, edit,
 * move and delete them. Each save is one question, whole (all or nothing in the database). A quiz imported from Kajabi is shown
 * and cannot be changed until its course is taken over.
 */
export default function QuizQuestionsEditor({ courseId, lessonId, questions, editable, attemptCount }: { courseId: string; lessonId: string; questions: EditorQuestion[]; editable: boolean; attemptCount: number }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<EditorQuestion | null>(null);

  const run = async (action: () => Promise<{ error?: string }>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return false;
    }
    router.refresh();
    return true;
  };
  const move = (id: string, position: number) => {
    const order = moveToPosition(questions.map((q) => q.id), id, position);
    void run(() => reorderQuizQuestions(courseId, lessonId, order));
  };

  return (
    <div className="space-y-4">
      {!editable && <p className="rounded border border-slate-200 p-3 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300">This quiz is imported from Kajabi, so it can&apos;t be changed here. Take the course over from Kajabi to edit it.</p>}
      {editable && attemptCount > 0 && (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          Members have made {attemptCount} {attemptCount === 1 ? "attempt" : "attempts"} at this quiz. Changing questions doesn&apos;t change the scores they already got.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      {questions.length === 0 && editing !== "new" && <p className="text-sm text-slate-600 dark:text-slate-400">No questions yet.</p>}
      <ol className="space-y-3">
        {questions.map((q, i) => (
          <li key={q.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
            {editing === q.id ? (
              <QuestionForm
                key={q.id}
                label={`Edit question ${i + 1}`}
                initial={draftOf(q)}
                busy={busy}
                error={error}
                onCancel={() => {
                  setEditing(null);
                  setError(null);
                }}
                onSave={async (draft) => {
                  if (await run(() => saveQuizQuestion(courseId, lessonId, q.id, draft))) setEditing(null);
                }}
              />
            ) : (
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <QuestionView question={q} number={i + 1} />
                </div>
                {editable && (
                  <div className="flex shrink-0 items-center">
                    <button type="button" aria-label={`Edit question ${i + 1}`} disabled={busy} onClick={() => { setError(null); setEditing(q.id); }} className={ICON_BUTTON}>
                      <Icon name="edit" />
                    </button>
                    {questions.length > 1 && <ActionMenu label={`Move question ${i + 1}`} heading={positionsHeading(questions.length)} items={positionItems(questions.length, i, (position) => move(q.id, position), "admin-quiz-move-question").map((item) => ({ ...item, disabled: item.disabled || busy }))} trigger={<Icon name="reorder" />} triggerClassName={ICON_BUTTON} tooltip="Move to position" />}
                    <button type="button" aria-label={lifecycleLabel("delete", `question ${i + 1}`)} disabled={busy} onClick={() => setDeleting(q)} className={ICON_BUTTON}>
                      <Icon name={lifecycleIcon("delete")} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>

      {editable &&
        (editing === "new" ? (
          <QuestionForm
            label="New question"
            initial={blankQuestion()}
            busy={busy}
            error={error}
            onCancel={() => {
              setEditing(null);
              setError(null);
            }}
            onSave={async (draft) => {
              if (await run(() => saveQuizQuestion(courseId, lessonId, null, draft))) setEditing(null);
            }}
          />
        ) : (
          <button type="button" disabled={busy || editing !== null} onClick={() => { setError(null); setEditing("new"); }} className={`${BUTTON} inline-flex items-center gap-1`}>
            <Icon name="plus" />
            Add question
          </button>
        ))}

      {deleting && (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const target = deleting;
            const ok = await run(() => deleteQuizQuestion(courseId, lessonId, target.id));
            // The reason a delete failed is shown above the questions, so the dialog closes either way.
            if (ok) setEditing(null);
          }}
          {...lifecycleConfirm("delete", {
            noun: "question",
            title: deleting.prompt.length > 60 ? `${deleting.prompt.slice(0, 57)}…` : deleting.prompt,
            detail: attemptCount > 0 ? "The answers members gave to it are deleted too; their scores stay." : undefined,
            permanent: true,
          })!}
        />
      )}
    </div>
  );
}
