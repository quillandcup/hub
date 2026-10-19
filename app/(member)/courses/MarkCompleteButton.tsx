"use client";

import { useState, useTransition } from "react";
import { setLessonComplete } from "./actions";

/** "Mark complete" / "Completed" toggle. Disabled (with a reason) in sudo, which is read-only. */
export default function MarkCompleteButton({ lessonId, completed, readOnly }: { lessonId: string; completed: boolean; readOnly: boolean }) {
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
        title={readOnly ? "Progress can't be changed while viewing as a member" : undefined}
        className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-60 ${
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
