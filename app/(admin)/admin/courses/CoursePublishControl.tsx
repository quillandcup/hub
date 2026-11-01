"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCoursePublished } from "./actions";

/**
 * Whether members can open the course. It is the same for a course imported from Kajabi and one made
 * in the Hub: where a course is authored is a separate matter from whether it is available.
 */
export default function CoursePublishControl({ courseId, isDraft }: { courseId: string; isDraft: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function change() {
    setError(null);
    start(async () => {
      const result = await setCoursePublished(courseId, isDraft);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span
        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
          isDraft ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" : "bg-plum-100 text-plum-800 dark:bg-plum-900/30 dark:text-plum-200"
        }`}
      >
        {isDraft ? "Draft" : "Published"}
      </span>
      <span className="text-sm text-slate-600 dark:text-slate-300">
        {isDraft ? "Only staff can see it. Members who have access can open it once you publish." : "Members who have access can open it."}
      </span>
      <button
        type="button"
        onClick={change}
        disabled={pending}
        data-track={isDraft ? "admin-course-publish" : "admin-course-unpublish"}
        className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:hover:bg-slate-800"
      >
        {pending ? "Saving…" : isDraft ? "Publish" : "Unpublish"}
      </button>
      {error && (
        <span role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}
