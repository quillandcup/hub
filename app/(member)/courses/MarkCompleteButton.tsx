"use client";

import { useState, useTransition } from "react";
import { setLessonComplete } from "./actions";

/** "Mark complete" / "Completed" toggle. Disabled, with a reason, when read-only (sudo, or a staff preview). */
export default function MarkCompleteButton({
  lessonId,
  completed,
  readOnly,
  readOnlyReason = "Progress can't be changed while viewing as a member",
  fullWidth = false,
}: {
  lessonId: string;
  completed: boolean;
  readOnly: boolean;
  /** Why it's disabled, shown as the tooltip. */
  readOnlyReason?: string;
  /** Stretch across the column (the lesson page's main action). */
  fullWidth?: boolean;
}) {
  const [done, setDone] = useState(completed);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !done;
    setDone(next);
    setError(null);
    startTransition(async () => {
      const result = await setLessonComplete(lessonId, next);
      if (result.error) {
        setDone(!next);
        setError(result.error);
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        disabled={readOnly || pending}
        aria-pressed={done}
        title={readOnly ? readOnlyReason : undefined}
        className={`rounded-lg text-sm font-medium transition disabled:opacity-60 ${fullWidth ? "w-full px-6 py-3" : "px-4 py-2"} ${
          done
            ? "border border-plum-600 text-plum-700 hover:bg-plum-50 dark:text-plum-300 dark:hover:bg-slate-800"
            : "bg-plum-600 text-white hover:bg-plum-700"
        }`}
      >
        {done ? "✓ Completed" : "Mark complete"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
