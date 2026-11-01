"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COURSE_FILES_BUCKET, formatBytes } from "@/lib/courses/file-format";
import { finishLessonFileUpload, removeLessonFile, startLessonFileUpload } from "../../../lesson-file-actions";

const BUTTON =
  "rounded border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600";

export interface LessonFile {
  id: string | null;
  filename: string;
  sizeBytes: number | null;
}

/**
 * The downloads of a Hub-owned lesson: the files members can save, with Add files and Remove. Each chosen file
 * goes straight to storage through a one-use signed upload and is then recorded for the lesson; files are sent
 * one after another, and one that fails is reported without stopping the rest.
 */
export default function LessonFilesField({ courseId, lessonId, files }: { courseId: string; lessonId: string; files: LessonFile[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const sendOne = async (file: File): Promise<string | null> => {
    const started = await startLessonFileUpload(courseId, lessonId, { filename: file.name, size: file.size });
    if (started.error || !started.path || !started.token || !started.fileKey) return started.error ?? "Couldn't start the upload.";
    const { error } = await createClient().storage.from(COURSE_FILES_BUCKET).uploadToSignedUrl(started.path, started.token, file, { contentType: file.type || undefined });
    if (error) return error.message;
    const finished = await finishLessonFileUpload(courseId, lessonId, { fileKey: started.fileKey, filename: file.name, type: file.type });
    return finished.error ?? null;
  };

  const add = async (chosen: File[]) => {
    setBusy(true);
    setErrors([]);
    const failed: string[] = [];
    for (const file of chosen) {
      setSending(file.name);
      try {
        const problem = await sendOne(file);
        if (problem) failed.push(`${file.name}: ${problem}`);
      } catch {
        failed.push(`${file.name}: something went wrong.`);
      }
    }
    setSending(null);
    setErrors(failed);
    setBusy(false);
    router.refresh();
  };

  const remove = async (file: LessonFile) => {
    if (!file.id) return;
    setBusy(true);
    setErrors([]);
    try {
      const result = await removeLessonFile(courseId, lessonId, file.id);
      if (result.error) setErrors([`${file.filename}: ${result.error}`]);
      else router.refresh();
    } catch {
      setErrors([`${file.filename}: something went wrong.`]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {files.length > 0 ? (
        <ul className="space-y-2">
          {files.map((f) => (
            <li key={f.id ?? f.filename} className="flex items-center justify-between gap-3 rounded border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
              <span className="min-w-0">
                {f.filename}
                {formatBytes(f.sizeBytes) && <span className="ml-2 text-xs text-slate-600 dark:text-slate-400">{formatBytes(f.sizeBytes)}</span>}
              </span>
              <button type="button" aria-label={`Remove ${f.filename}`} className={BUTTON} disabled={busy} onClick={() => void remove(f)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-600 dark:text-slate-400">No downloads.</p>
      )}
      <input
        ref={input}
        type="file"
        multiple
        aria-label="Choose files to add"
        className="sr-only"
        onChange={(e) => {
          const chosen = [...(e.target.files ?? [])];
          e.target.value = "";
          if (chosen.length > 0) void add(chosen);
        }}
      />
      <button type="button" className={`${BUTTON} mt-3`} disabled={busy} onClick={() => input.current?.click()}>
        Add files
      </button>
      {sending && <p role="status" className="mt-2 text-sm text-slate-600 dark:text-slate-400">Uploading {sending}…</p>}
      {errors.map((message) => (
        <p key={message} role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
          {message}
        </p>
      ))}
    </div>
  );
}
