"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import type { DuplicatePreview } from "@/lib/courses/duplicate";
import { duplicateCourse } from "../duplicate-actions";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The "Duplicate this course?" dialog (opened from the course page's actions menu): copies a course (imported from Kajabi or made in the Hub) into a new draft course the Hub owns, so
 * the editor can be tried on the copy while the original stays as it is. It says what is and isn't copied first.
 */
export default function DuplicatePanel({ courseId, title, preview, open, onClose }: { courseId: string; title: string; preview: DuplicatePreview; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await duplicateCourse(courseId);
      if (result.error || !result.id) setError(result.error ?? "Couldn't copy the course.");
      else {
        onClose();
        router.push(`/admin/courses/${result.id}`);
      }
    } catch {
      setError("Something went wrong. Refresh the page and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={() => !busy && onClose()} title="Duplicate this course?" maxWidth="lg">
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
          <button type="button" disabled={busy} onClick={onClose} className="rounded border border-slate-300 px-3 py-1.5 font-medium disabled:opacity-60 dark:border-slate-600">
            Cancel
          </button>
          <button type="button" data-track="admin-course-duplicate-confirm" disabled={busy} onClick={confirm} className="rounded bg-plum-600 px-3 py-1.5 font-medium text-white disabled:opacity-60">
            {busy ? "Copying…" : "Duplicate"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
