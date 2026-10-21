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
 * asks first and says how much it is about to upload. Videos of lessons members can see are one list
 * and button; videos only Kajabi drafts use are a separate list with their own button, so a draft is
 * never uploaded (and billed) by pressing the normal one.
 */
export default function CourseVideosPanel({ slug, videos: all }: { slug: string | null; videos: PlannedVideo[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [confirmingDrafts, setConfirmingDrafts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const videos = all.filter((v) => !v.draft);
  const drafts = all.filter((v) => v.draft);
  const toUpload = videos.filter((v) => v.state === "ready_to_upload");
  const uploadMinutes = toUpload.reduce((sum, v) => sum + minutes(v.durationSeconds), 0);
  const draftsToUpload = drafts.filter((v) => v.state === "ready_to_upload");
  const draftMinutes = draftsToUpload.reduce((sum, v) => sum + minutes(v.durationSeconds), 0);
  const preparing = all.filter((v) => v.state === "uploaded" && v.videoStatus === "preparing").length;

  async function run(action: "upload" | "upload_drafts" | "refresh") {
    setBusy(true);
    setMessage(null);
    setConfirming(false);
    setConfirmingDrafts(false);
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
      {videos.length === 0 && drafts.length === 0 ? (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">No visible lesson has a video recorded yet.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {videos.length} {videos.length === 1 ? "video" : "videos"} in lessons members can see (open or coming soon). Videos only drafts use are listed separately below and uploaded only when you ask.
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
          {drafts.length > 0 && (
            <div className="mt-6 border-t border-slate-100 pt-4 dark:border-slate-800">
              <h3 className="font-medium">Draft lessons&apos; videos</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {drafts.length} {drafts.length === 1 ? "video is" : "videos are"} used only by Kajabi drafts. Members never see them; upload them to preview those lessons. Some drafts are leftovers, so this is a separate step.
              </p>
              <ul className="mt-3 divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {drafts.map((v) => (
                  <li key={v.mediaId} className="flex flex-wrap items-center gap-x-3 py-1.5">
                    <span className="min-w-0 flex-1">{v.lessonTitles.join(", ")}</span>
                    {minutes(v.durationSeconds) > 0 && <span className="text-xs text-slate-500 dark:text-slate-400">{minutes(v.durationSeconds)} min</span>}
                    <span className="text-xs text-slate-500 dark:text-slate-400">{statusText(v)}</span>
                  </li>
                ))}
              </ul>
              {slug && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {confirmingDrafts ? (
                    <>
                      <span className="text-sm">
                        Upload {draftsToUpload.length} draft {draftsToUpload.length === 1 ? "video" : "videos"} (about {draftMinutes} minutes) to Mux? Mux bills per minute.
                      </span>
                      <button type="button" onClick={() => run("upload_drafts")} disabled={busy} className="rounded bg-plum-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50">
                        Upload drafts
                      </button>
                      <button type="button" onClick={() => setConfirmingDrafts(false)} className="rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingDrafts(true)}
                      disabled={busy || draftsToUpload.length === 0}
                      className="rounded border border-plum-600 px-3 py-1.5 text-sm font-medium text-plum-700 hover:bg-plum-50 disabled:opacity-50 dark:text-plum-300 dark:hover:bg-slate-800"
                    >
                      {busy ? "Working…" : `Upload ${draftsToUpload.length} draft ${draftsToUpload.length === 1 ? "video" : "videos"} to Mux`}
                    </button>
                  )}
                </div>
              )}
            </div>
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
