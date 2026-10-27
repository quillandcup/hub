"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FilePlan, PlannedFile } from "@/lib/courses/files";

const STATE_TEXT: Record<PlannedFile["state"], string> = {
  copied: "In the Hub",
  ready_to_copy: "Ready to copy",
  link_expired: "Link expired: run the content step again",
  no_link: "No download link recorded",
  lesson_not_in_hub: "Its lesson isn't in the Hub yet: publish or sync first",
};

/**
 * A course's lesson downloads and the button that copies them into the Hub (docs/COURSES.md, step D,
 * files). Draft lessons' files are listed and copied with the rest (they cost nothing and staff preview
 * those lessons); they are marked, and only staff can open them.
 */
export default function CourseFilesPanel({ slug, plan }: { slug: string | null; plan: FilePlan }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const toCopy = plan.files.filter((f) => f.state === "ready_to_copy").length;
  const actionable = toCopy + plan.stale.length;

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/process/course-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ course: slug }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed");
      const parts = [`Copied ${data.copied.length}`];
      if (data.removed > 0) parts.push(`removed ${data.removed}`);
      if (data.needsNewLink.length > 0) parts.push(`${data.needsNewLink.length} need a new link`);
      if (data.failed.length > 0) parts.push(`${data.failed.length} failed: ${data.failed[0].error}`);
      const images = data.images;
      if (images && (images.copied > 0 || images.removed > 0)) parts.push(`images: copied ${images.copied}, removed ${images.removed}`);
      if (images?.failed.length > 0) parts.push(`${images.failed.length} images failed: ${images.failed[0].error}`);
      setMessage({ ok: data.failed.length === 0 && !(images?.failed.length > 0), text: parts.join(", ") + "." });
      router.refresh();
    } catch (err: any) {
      setMessage({ ok: false, text: err.message || "Failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-lg bg-white p-6 shadow dark:bg-slate-900">
      <h2 className="text-lg font-semibold">Downloads</h2>
      {plan.files.length === 0 && plan.stale.length === 0 ? (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">No lesson has a download recorded.</p>
      ) : (
        <>
          {plan.files.some((f) => f.draft) && (
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Files of draft lessons are copied too, marked Draft. Members never see them; staff can open them in a preview.
            </p>
          )}
          <ul className="mt-3 divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {plan.files.map((f) => (
              <li key={f.kajabiFileId} className="flex flex-wrap items-center gap-x-3 py-1.5">
                <span className="min-w-0 flex-1">
                  {f.filename} <span className="text-xs text-slate-600 dark:text-slate-400">· {f.lessonTitle}</span>
                  {f.draft && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">Draft</span>}
                </span>
                <span className="text-xs text-slate-600 dark:text-slate-400">{STATE_TEXT[f.state]}</span>
              </li>
            ))}
            {plan.stale.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3 py-1.5">
                <span className="min-w-0 flex-1">{f.filename}</span>
                <span className="text-xs text-slate-600 dark:text-slate-400">No longer listed: will be removed</span>
              </li>
            ))}
          </ul>
          {slug ? (
            <div className="mt-4">
              <button
                type="button"
                onClick={run}
                disabled={busy || actionable === 0}
                className="rounded bg-plum-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50"
              >
                {busy ? "Working…" : `Copy ${toCopy} ${toCopy === 1 ? "file" : "files"}${plan.stale.length > 0 ? ` and remove ${plan.stale.length}` : ""}`}
              </button>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Publish the course first; files can then be copied here.</p>
          )}
        </>
      )}
      {slug && (
        <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="text-sm font-semibold">Images</h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            The course cover, module posters and lesson thumbnails are shown from the Hub once copied (until then, from Kajabi). Copying also
            does the files above.
          </p>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="mt-3 rounded bg-plum-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50"
          >
            {busy ? "Working…" : "Copy images"}
          </button>
        </div>
      )}
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`mt-3 text-sm ${message.ok ? "" : "text-red-700 dark:text-red-300"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
