"use client";

import { useLessonCompletion } from "@/components/courses/LessonCompletion";
import Tooltip from "@/components/Tooltip";

/**
 * The lesson page's main action, wide across its column. "Mark as complete" (white, outlined) until the
 * lesson is done, then "Complete" in the Hub's color: the player sets it at ~90% watched, or the
 * member presses it, and pressing it again clears it. Disabled, with the reason as its tooltip, when
 * read-only (sudo, or a staff preview). Needs a LessonCompletionProvider.
 */
export default function MarkCompleteButton() {
  const completion = useLessonCompletion();
  if (!completion) return null;
  const { completed, readOnlyReason, error, pending, toggle } = completion;

  return (
    <div>
      <Tooltip content={readOnlyReason ?? undefined}>
        <button
          type="button"
          onClick={toggle}
          data-track={completed ? "lesson-unmark-complete" : "lesson-mark-complete"}
          disabled={!!readOnlyReason || pending}
          aria-pressed={completed}
          className={`w-full rounded-lg border-2 border-plum-600 px-6 py-3 text-sm font-semibold transition disabled:opacity-60 ${
            completed
              ? "bg-plum-600 text-white hover:bg-plum-700"
              : "bg-white text-plum-700 hover:bg-plum-50 dark:bg-transparent dark:text-plum-300 dark:hover:bg-slate-800"
          }`}
        >
          {completed ? "Complete" : "Mark as complete"}
        </button>
      </Tooltip>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
