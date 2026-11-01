"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import type { TakeOverPreview } from "@/lib/courses/take-over";
import { takeOverCourse } from "../take-over-actions";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * "Edit this course in the Hub": turns a course imported from Kajabi into one the Hub owns. It says what will change
 * first (the dry run), and that it is one way, and only then does it.
 */
export default function TakeOverPanel({ courseId, title, preview }: { courseId: string; title: string; preview: TakeOverPreview }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked = preview.tooDeep
    ? "Its modules are nested deeper than the editor handles (a module has submodules, and a submodule has lessons). Flatten it in Kajabi, then import again."
    : preview.lessons === 0
      ? "It has no lessons in the Hub yet. Import it from Kajabi first."
      : null;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await takeOverCourse(courseId);
      if (result.error) setError(result.error);
      else {
        setOpen(false);
        // The course page is now the Hub's own, with the editor.
        router.refresh();
      }
    } catch {
      setError("Something went wrong. Refresh the page and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 rounded-lg bg-white p-6 shadow dark:bg-slate-900">
      <h2 className="mb-2 text-lg font-semibold">Edit this course in the Hub</h2>
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        Right now this course is read only here: it is copied from Kajabi on every import. Taking it over makes the Hub its home, so you can change it here.
      </p>
      {blocked && <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{blocked}</p>}
      <button
        type="button"
        data-track="admin-course-take-over-open"
        disabled={!!blocked}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600"
      >
        Take over from Kajabi
      </button>

      <Modal isOpen={open} onClose={() => !busy && setOpen(false)} title="Take over from Kajabi?" maxWidth="lg">
        <div className="space-y-3 text-sm">
          <p>
            This makes <strong>{title}</strong> a course the Hub owns.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              What moves over, unchanged: {plural(preview.modules, "module")} and {plural(preview.lessons, "lesson")} ({preview.withText} with text, {preview.withVideo} with a video),{" "}
              {plural(preview.downloads, "download")}. Members keep their access, their progress and the addresses they use.
            </li>
            {preview.withoutSetting > 0 && (
              <li>
                {plural(preview.withoutSetting, "item")} {preview.withoutSetting === 1 ? "has" : "have"} no status in Kajabi. {preview.withoutSetting === 1 ? "It becomes a draft" : "They become drafts"}, which members
                already can&apos;t see them as.
              </li>
            )}
            <li>
              <strong>The Kajabi import skips this course from now on.</strong> What you change in Kajabi won&apos;t come across, and what you change here is never overwritten. Members&apos; progress in Kajabi
              is no longer imported for it either.
            </li>
            <li>
              <strong>It can&apos;t be undone.</strong>
            </li>
          </ul>
          {error && (
            <p role="alert" className="text-red-700 dark:text-red-300">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" disabled={busy} onClick={() => setOpen(false)} className="rounded border border-slate-300 px-3 py-1.5 font-medium disabled:opacity-60 dark:border-slate-600">
              Cancel
            </button>
            <button type="button" data-track="admin-course-take-over-confirm" disabled={busy} onClick={confirm} className="rounded bg-plum-600 px-3 py-1.5 font-medium text-white disabled:opacity-60">
              {busy ? "Taking over…" : "Take over"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
