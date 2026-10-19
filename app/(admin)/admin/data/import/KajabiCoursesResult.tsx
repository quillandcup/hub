"use client";

import { useState } from "react";
import type { CoursesSyncResult } from "@/lib/courses/sync";

/** Access lengths a course can be published with; the choice is required, there is no default. */
const ACCESS_OPTIONS: { label: string; value: string | null }[] = [
  { label: "Lifetime", value: null },
  { label: "1 year", value: "1 year" },
  { label: "6 months", value: "6 months" },
  { label: "3 months", value: "3 months" },
];

type Unpublished = NonNullable<CoursesSyncResult["unpublished"]>[number];

function PublishRow({ course, onPublished }: { course: Unpublished; onPublished: (slug: string, summary: string) => void }) {
  const [choice, setChoice] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function publish() {
    const access = ACCESS_OPTIONS[Number(choice)];
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/process/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ course: course.slug, accessDuration: access.value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to publish");
      const done = data.courses?.[0];
      onPublished(
        course.slug,
        done ? `${done.lessons} lessons (${done.comingSoon} coming soon), access for ${done.access.members} members` : "published"
      );
    } catch (err: any) {
      setError(err.message || "Failed to publish");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{course.title}</span>
        <select
          aria-label={`Access length for ${course.title}`}
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
        >
          <option value="" disabled>
            Access length…
          </option>
          {ACCESS_OPTIONS.map((o, i) => (
            <option key={o.label} value={i}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={publish}
          disabled={choice === "" || busy}
          className="rounded bg-plum-600 px-3 py-1 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50"
        >
          {busy ? "Publishing…" : "Publish"}
        </button>
      </div>
      {error && <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-300">{error}</p>}
    </li>
  );
}

/** The course part of a Kajabi sync result: what was imported, what was refreshed, and what still needs publishing. */
export default function KajabiCoursesResult({ courses }: { courses: CoursesSyncResult }) {
  const [published, setPublished] = useState<Record<string, string>>({});

  if (courses.error && !courses.imported) {
    return (
      <div role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
        <p className="font-semibold">Courses sync failed (the member sync above is unaffected)</p>
        <p className="break-words">{courses.error}</p>
      </div>
    );
  }

  const unplaced = (courses.imported?.courses ?? []).filter((c) => c.unplacedLessons > 0);
  const unpublished = (courses.unpublished ?? []).filter((c) => !(c.slug in published));

  return (
    <div className="mt-4 rounded-lg border border-plum-200 bg-plum-50 p-4 text-sm text-plum-700 dark:border-plum-800 dark:bg-plum-900/20 dark:text-plum-300">
      <p className="mb-2 font-semibold text-plum-800 dark:text-plum-200">✓ Courses</p>
      <ul className="space-y-0.5">
        {(courses.imported?.courses ?? []).map((c) => (
          <li key={c.id}>
            • {c.title}: {c.modules} modules, {c.lessons} lessons, {c.offers} offers
          </li>
        ))}
      </ul>

      {(courses.processed ?? []).length > 0 && (
        <div className="mt-2 border-t border-plum-200 pt-2 dark:border-plum-700">
          <p className="font-semibold">Published courses refreshed:</p>
          <ul className="space-y-0.5">
            {(courses.processed ?? []).map((p) => (
              <li key={p.slug}>
                • {p.slug}: {p.lessons} lessons ({p.comingSoon} coming soon), {p.access.members} with access
                {p.access.removed > 0 && `, ${p.access.removed} access removed`}
                {(p.deleted.lessons > 0 || p.deleted.modules > 0) && `, ${p.deleted.lessons} lessons and ${p.deleted.modules} modules removed`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {unplaced.length > 0 && (
        <p role="alert" className="mt-2 text-amber-800 dark:text-amber-300">
          ⚠ {unplaced.map((c) => `${c.title}: ${c.unplacedLessons} lessons not placed in a module`).join("; ")}. Kajabi&apos;s response
          doesn&apos;t match what the importer expects; those lessons show outside their modules.
        </p>
      )}

      {unpublished.length > 0 && (
        <div className="mt-2 border-t border-plum-200 pt-2 dark:border-plum-700">
          <p className="font-semibold">Not published in the Hub yet:</p>
          <ul className="divide-y divide-plum-100 dark:divide-plum-800">
            {unpublished.map((c) => (
              <PublishRow key={c.slug} course={c} onPublished={(slug, summary) => setPublished((prev) => ({ ...prev, [slug]: summary }))} />
            ))}
          </ul>
        </div>
      )}

      {Object.entries(published).map(([slug, summary]) => (
        <p key={slug} role="status" className="mt-2">
          ✓ Published {slug}: {summary}
        </p>
      ))}

      {courses.error && <p role="alert" className="mt-2 text-amber-800 dark:text-amber-300">Processing stopped: {courses.error}</p>}
    </div>
  );
}
