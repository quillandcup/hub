"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import type { DuplicatePreview } from "@/lib/courses/duplicate";
import { duplicateCourse } from "../duplicate-actions";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * "Duplicate course": copies a course (imported from Kajabi or made in the Hub) into a new draft course the Hub owns, so
 * the editor can be tried on the copy while the original stays as it is. It says what is and isn't copied first.
 */
export default function DuplicatePanel({ courseId, title, preview }: { courseId: string; title: string; preview: DuplicatePreview }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked = preview.tooDeep ? "Its modules are nested deeper than the editor handles (a module has submodules, and a submodule has lessons), so it can't be copied." : null;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await duplicateCourse(courseId);
      if (result.error || !result.id) setError(result.error ?? "Couldn't copy the course.");
      else {
        setOpen(false);
        router.push(`/admin/courses/${result.id}`);
      }
    } catch {
      setError("Something went wrong. Refresh the page and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 rounded-lg bg-white p-6 shadow dark:bg-slate-900">
      <h2 className="mb-2 text-lg font-semibold">Duplicate course</h2>
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        Make a copy you can edit freely, for example to try the course editor, while this course stays as it is. The copy is a draft that members can&apos;t see.
      </p>
      {blocked && <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{blocked}</p>}
      <button
        type="button"
        data-track="admin-course-duplicate-open"
        disabled={!!blocked}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600"
      >
        Duplicate course
      </button>

      <Modal isOpen={open} onClose={() => !busy && setOpen(false)} title="Duplicate this course?" maxWidth="lg">
        <div className="space-y-3 text-sm">
          <p>
            This makes a new course from <strong>{title}</strong>, called &ldquo;{title} (copy)&rdquo;.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Copied:</strong> {plural(preview.modules, "module")} and {plural(preview.lessons, "lesson")} in the same order, with their text, pictures and {plural(preview.downloads, "download")}. {plural(preview.withVideo, "lesson")} with a video{" "}
              {preview.withVideo === 1 ? "plays" : "play"} the same video as here, not one uploaded again.
            </li>
            <li>
              <strong>Not copied:</strong> members&apos; access and progress, comments, and the link to a program. Add the program to the copy if you need it.
            </li>
            <li>
              <strong>It is a draft</strong> course the Hub owns, with every module and lesson a draft. Members can&apos;t see it until you publish it. Kajabi never touches it, and this course keeps syncing as
              before.
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
            <button type="button" data-track="admin-course-duplicate-confirm" disabled={busy} onClick={confirm} className="rounded bg-plum-600 px-3 py-1.5 font-medium text-white disabled:opacity-60">
              {busy ? "Copying…" : "Duplicate"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
