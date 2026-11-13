"use client";

import { useState } from "react";
import { usePlayerSeconds } from "@/components/courses/PlayerTime";

/** "Copy link" under a lesson's video: the lesson's address (at the player's position when it is past the start), which becomes the video card when pasted into a Hub Chat message. */
export default function CopyLessonLink({ url }: { url: string }) {
  const [status, setStatus] = useState<"copied" | "failed" | null>(null);
  const seconds = usePlayerSeconds();

  async function copy() {
    try {
      await navigator.clipboard.writeText(seconds > 0 ? `${url}?t=${seconds}` : url);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <button type="button" onClick={copy} data-track="lesson-copy-link" className="text-sm font-medium text-plum-600 hover:underline dark:text-plum-400">
        Copy link
      </button>
      <span className="text-sm text-slate-600 dark:text-slate-400">Paste it into Hub Chat to share the video there.</span>
      {status && (
        <span role="status" className="text-sm text-slate-700 dark:text-slate-300">
          {status === "copied" ? "Copied." : "Couldn't copy. The address in your browser's address bar works the same way."}
        </span>
      )}
    </div>
  );
}
