"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatClock } from "@/lib/courses/watch-stats";
import { setLessonThumbnailFromVideo } from "../../../lesson-video-actions";

/** Makes the lesson's thumbnail from the video as it looks where the player is now. */
export default function FrameThumbnailButton({ courseId, lessonId, seconds }: { courseId: string; lessonId: string; seconds: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error?: string; done?: string } | null>(null);

  const use = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await setLessonThumbnailFromVideo(courseId, lessonId, seconds);
      if (result.error) setMessage({ error: result.error });
      else {
        setMessage({ done: `Thumbnail set from ${formatClock(seconds)}.` });
        router.refresh();
      }
    } catch {
      setMessage({ error: "Something went wrong. Refresh the page and try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="text-right">
      <button
        type="button"
        data-track="admin-lesson-frame-thumbnail"
        disabled={busy}
        onClick={use}
        title={`Uses the frame at ${formatClock(seconds)}`}
        className="text-sm text-plum-700 hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-plum-300"
      >
        {busy ? "Making the thumbnail…" : "Use current frame as thumbnail"}
      </button>
      {message?.done && <p role="status" className="mt-2 text-sm text-slate-600 dark:text-slate-400">{message.done}</p>}
      {message?.error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{message.error}</p>}
    </div>
  );
}
