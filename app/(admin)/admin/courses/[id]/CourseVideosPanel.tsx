"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PlannedVideo } from "@/lib/courses/media";

const STATE_TEXT: Record<PlannedVideo["state"], string> = {
  uploaded: "In Mux",
  ready_to_upload: "Ready to upload",
  link_expired: "Link expired: run the Kajabi content step again",
  no_link: "No download link recorded",
};

function statusText(v: PlannedVideo): string {
  if (v.state === "uploaded") return v.videoStatus === "ready" ? "Ready" : "Preparing in Mux";
  if (v.videoStatus === "errored") return "Failed last time (will retry)";
  return STATE_TEXT[v.state];
}

const minutes = (seconds: number | null) => (seconds ? Math.round(seconds / 60) : 0);

/**
 * A course's videos and the Mux step (docs/COURSES.md, step D). Uploading is billed per minute, so it
 * asks first and says how much it is about to upload; only visible lessons' videos are included.
 */
export default function CourseVideosPanel({ slug, videos }: { slug: string | null; videos: PlannedVideo[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const toUpload = videos.filter((v) => v.state === "ready_to_upload");
  const uploadMinutes = toUpload.reduce((sum, v) => sum + minutes(v.durationSeconds), 0);
  const preparing = videos.filter((v) => v.state === "uploaded" && v.videoStatus === "preparing").length;

  async function run(action: "upload" | "refresh") {
    setBusy(true);
    setMessage(null);
    setConfirming(false);
    try {
      const response = await fetch("/api/process/course-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ course: slug, action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed");
      const parts: string[] = [];
      if (data.upload) {
        parts.push(`Uploaded ${data.upload.uploaded.length}`);
        if (data.upload.needsNewLink.length > 0) parts.push(`${data.upload.needsNewLink.length} need a new link`);
        if (data.upload.failed.length > 0) parts.push(`${data.upload.failed.length} failed: ${data.upload.failed[0].error}`);
      }
      parts.push(`${data.refresh.ready} ready, ${data.refresh.stillPreparing} still preparing`);
      setMessage({ ok: !(data.upload?.failed.length > 0), text: parts.join(". ") + "." });
      router.refresh();
    } catch (err: any) {
      setMessage({ ok: false, text: err.message || "Failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-lg bg-white p-6 shadow dark:bg-slate-900">
      <h2 className="text-lg font-semibold">Videos</h2>
      {videos.length === 0 ? (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">No visible lesson has a video recorded yet.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {videos.length} {videos.length === 1 ? "video" : "videos"} in lessons members can see (open or coming soon); draft lessons are never uploaded.
          </p>
          <ul className="mt-3 divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {videos.map((v) => (
              <li key={v.mediaId} className="flex flex-wrap items-center gap-x-3 py-1.5">
                <span className="min-w-0 flex-1">{v.lessonTitles.join(", ")}</span>
                {minutes(v.durationSeconds) > 0 && <span className="text-xs text-slate-500 dark:text-slate-400">{minutes(v.durationSeconds)} min</span>}
                <span className="text-xs text-slate-500 dark:text-slate-400">{statusText(v)}</span>
              </li>
            ))}
          </ul>

          {slug ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {confirming ? (
                <>
                  <span className="text-sm">
                    Upload {toUpload.length} {toUpload.length === 1 ? "video" : "videos"} (about {uploadMinutes} minutes) to Mux? Mux bills per minute.
                  </span>
                  <button type="button" onClick={() => run("upload")} disabled={busy} className="rounded bg-plum-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50">
                    Upload
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} className="rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600">
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    disabled={busy || toUpload.length === 0}
                    className="rounded bg-plum-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50"
                  >
                    {busy ? "Working…" : `Upload ${toUpload.length} to Mux`}
                  </button>
                  <button
                    type="button"
                    onClick={() => run("refresh")}
                    disabled={busy || preparing === 0}
                    className="rounded border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-slate-600"
                  >
                    Update status
                  </button>
                </>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Publish the course first; videos can then be uploaded here.</p>
          )}
          {message && (
            <p role={message.ok ? "status" : "alert"} className={`mt-3 text-sm ${message.ok ? "" : "text-red-700 dark:text-red-300"}`}>
              {message.text}
            </p>
          )}
        </>
      )}
    </div>
  );
}
