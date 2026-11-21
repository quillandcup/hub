"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CAPTION_LANGUAGES, MAX_CAPTION_CHARS, captionLanguageName } from "@/lib/courses/captions";
import { addLessonCaptions, generateLessonCaptions, removeLessonCaptions } from "../../../lesson-caption-actions";

const BUTTON =
  "rounded border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600";
const FIELD =
  "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800";

export interface CaptionTrack {
  id: string;
  label: string;
  language: string;
  kind: string;
  source: string;
}

const SOURCE_LABEL: Record<string, string> = { manual: "Uploaded", mux_auto: "Automatic", descript: "Descript", whisper: "Whisper" };

/**
 * The captions of a Hub-owned lesson's video: the tracks it has, a caption file (WebVTT or SubRip) to add, and a button
 * to have Mux write subtitles from the audio. The player offers every track from the stream, in its Captions menu.
 */
export default function LessonCaptions({ courseId, lessonId, tracks }: { courseId: string; lessonId: string; tracks: CaptionTrack[] }) {
  const router = useRouter();
  const [language, setLanguage] = useState("en");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ error?: string; done?: string } | null>(null);

  /** Runs one change; the page is refreshed when it worked. */
  const run = async (what: string, action: () => Promise<{ error?: string }>, done: string) => {
    setBusy(what);
    setMessage(null);
    try {
      const result = await action();
      if (result.error) setMessage({ error: result.error });
      else {
        setMessage({ done });
        router.refresh();
      }
    } catch {
      setMessage({ error: "Something went wrong. Refresh the page and try again." });
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file: File) => {
    if (file.size > MAX_CAPTION_CHARS) return setMessage({ error: "That file is too large for captions." });
    const text = await file.text();
    await run("add", () => addLessonCaptions(courseId, lessonId, { language, label, text }), "Captions added. They show in the player's captions menu.");
    setLabel("");
  };

  return (
    <div>
      {tracks.length > 0 ? (
        <ul className="space-y-2">
          {tracks.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 rounded border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
              <span className="min-w-0">
                {t.label}
                <span className="ml-2 text-xs text-slate-600 dark:text-slate-400">
                  {captionLanguageName(t.language)} · {SOURCE_LABEL[t.source] ?? t.source}
                </span>
              </span>
              <button
                type="button"
                aria-label={`Remove ${t.label}`}
                disabled={busy !== null}
                onClick={() => void run(`remove-${t.id}`, () => removeLessonCaptions(courseId, lessonId, t.id), `Removed ${t.label}.`)}
                className={BUTTON}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-600 dark:text-slate-400">No captions on this video yet.</p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Language</span>
          <select value={language} disabled={busy !== null} onChange={(e) => setLanguage(e.target.value)} className={FIELD}>
            {CAPTION_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Name</span>
          <input type="text" value={label} placeholder={captionLanguageName(language)} disabled={busy !== null} onChange={(e) => setLabel(e.target.value)} className={FIELD} />
        </label>
        <label className="sr-only" htmlFor={`caption-file-${lessonId}`}>
          Choose a caption file
        </label>
        <input
          id={`caption-file-${lessonId}`}
          type="file"
          accept=".vtt,.srt,text/vtt,application/x-subrip"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
        <button type="button" disabled={busy !== null} onClick={() => document.getElementById(`caption-file-${lessonId}`)?.click()} className={BUTTON}>
          {busy === "add" ? "Adding…" : "Upload captions"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run("generate", () => generateLessonCaptions(courseId, lessonId, language), "Mux is writing the captions. They appear in the player when it has finished.")}
          className={BUTTON}
        >
          {busy === "generate" ? "Asking Mux…" : "Make captions automatically"}
        </button>
      </div>
      {message?.done && <p role="status" className="mt-2 text-sm text-slate-600 dark:text-slate-400">{message.done}</p>}
      {message?.error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{message.error}</p>}
    </div>
  );
}
