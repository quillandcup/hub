"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { renameCourseItem, setCourseItemStatus, type OutlineResult } from "../../../outline-actions";
import { FOLLOW_CHOICE, STATUS_CHOICES, statusChoices } from "@/lib/courses/status-choices";

const FIELD =
  "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800";

/** Runs a change on this lesson; the reason it was refused is shown beside the field, and the page is refreshed when it worked. */
function useChange() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<OutlineResult>) => {
    setError(null);
    setBusy(true);
    try {
      const result = await action();
      if (result.error) setError(result.error);
      else router.refresh();
      return !result.error;
    } catch {
      setError("Something went wrong. Refresh the page and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** The title of a Hub-owned lesson, saved when the field is left or Enter is pressed. */
export function LessonTitleField({ courseId, lessonId, title }: { courseId: string; lessonId: string; title: string }) {
  const { busy, error, run } = useChange();
  const [value, setValue] = useState(title);
  const save = async () => {
    const next = value.trim();
    if (next === title) return setValue(title);
    if (!(await run(() => renameCourseItem(courseId, "lesson", lessonId, next)))) setValue(title);
  };
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">Title</span>
      <input
        type="text"
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className={FIELD}
      />
      {error && <span role="alert" className="mt-1 block text-red-700 dark:text-red-300">{error}</span>}
    </label>
  );
}

/** A Hub-owned lesson's own setting: follow what is above it, or Draft, Published or Locked. Schedule and Drip aren't offered yet. */
export function LessonStatusField({ courseId, lessonId, option }: { courseId: string; lessonId: string; option: string | null }) {
  const { busy, error, run } = useChange();
  const choices = statusChoices(option, true).filter((c) => c.value === FOLLOW_CHOICE.value || ["draft", "published", "locked"].includes(c.value));
  return (
    <fieldset disabled={busy}>
      <legend className="sr-only">Status</legend>
      <div className="space-y-2 text-sm">
        {choices.map((c) => (
          <label key={c.value} className="flex items-center gap-2">
            <input type="radio" name="status" checked={option === c.value} onChange={() => void run(() => setCourseItemStatus(courseId, "lesson", lessonId, c.value))} />
            {c.value === FOLLOW_CHOICE.value ? c.label : STATUS_CHOICES.find((x) => x.value === c.value)!.label}
          </label>
        ))}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
    </fieldset>
  );
}
