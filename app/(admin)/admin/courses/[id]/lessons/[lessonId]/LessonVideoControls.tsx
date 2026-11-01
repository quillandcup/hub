"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { refreshLessonVideo, removeLessonVideo, startLessonVideoUpload } from "../../../lesson-video-actions";

const BUTTON =
  "rounded border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600";

/** How often a video that is still being prepared is checked on. */
const POLL_MS = 15_000;

/**
 * Upload, replace and remove the video of a Hub-owned lesson. The file goes from the browser straight to Mux
 * in pieces (UpChunk, so a big file survives a dropped connection); Mux then prepares it, which takes a while,
 * so the page checks on it until it is ready or has failed.
 */
export default function LessonVideoControls({ courseId, lessonId, status }: { courseId: string; lessonId: string; status: string | null }) {
  const router = useRouter();
  const hasVideo = status !== null;
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    try {
      const result = await refreshLessonVideo(courseId, lessonId);
      if (result.error) setError(result.error);
      else if (result.status === "ready" || result.status === "errored") router.refresh();
      return result;
    } catch {
      setError("Something went wrong. Refresh the page and try again.");
      return null;
    }
  }, [courseId, lessonId, router]);

  // A video that is being prepared is checked on every so often until it is ready or has failed (either refreshes the page).
  const waiting = status === "preparing" && progress === null;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void check(), POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, check]);

  const upload = async (file: File) => {
    setError(null);
    setMessage(null);
    setProgress(0);
    try {
      const UpChunk = await import("@mux/upchunk");
      const started = UpChunk.createUpload({
        // Asked for when the upload starts, so the address is made only for a file that is really being sent.
        endpoint: async () => {
          const result = await startLessonVideoUpload(courseId, lessonId);
          if (result.error || !result.url) throw new Error(result.error ?? "Couldn't start the upload.");
          return result.url;
        },
        file,
      });
      started.on("progress", (event: CustomEvent<number>) => setProgress(Math.round(event.detail)));
      started.on("error", (event: CustomEvent<{ message?: string } | string>) => {
        const detail = typeof event.detail === "string" ? event.detail : event.detail?.message;
        setError(detail ? `The upload didn't finish: ${detail}` : "The upload didn't finish.");
        setProgress(null);
        router.refresh();
      });
      started.on("success", () => {
        setProgress(null);
        setMessage("Uploaded. Mux is preparing the video.");
        void check().then(() => router.refresh());
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the upload.");
      setProgress(null);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await removeLessonVideo(courseId, lessonId);
      if (result.error) setError(result.error);
      else {
        setMessage(null);
        router.refresh();
      }
    } catch {
      setError("Something went wrong. Refresh the page and try again.");
    } finally {
      setBusy(false);
    }
  };

  const uploading = progress !== null;
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept="video/*"
          aria-label="Choose a video file"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
        <button type="button" className={BUTTON} disabled={uploading || busy} onClick={() => input.current?.click()}>
          {hasVideo ? "Replace video" : "Upload video"}
        </button>
        {hasVideo && (
          <button type="button" className={BUTTON} disabled={uploading || busy} onClick={remove}>
            Remove video
          </button>
        )}
        {waiting && (
          <button type="button" className={BUTTON} onClick={() => void check()}>
            Check again
          </button>
        )}
      </div>
      {uploading && (
        <div className="mt-3" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <div className="h-2 w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
            <div className="h-full bg-plum-600" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Uploading… {progress}%. Keep this page open until it is done.</p>
        </div>
      )}
      {message && <p role="status" className="mt-2 text-sm text-slate-600 dark:text-slate-400">{message}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}
