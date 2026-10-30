"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const SOON = "Not available yet: courses are imported from Kajabi for now";
const ITEM = "flex w-full items-center gap-3 px-4 py-2 text-left text-sm";
const OFF = `${ITEM} cursor-not-allowed opacity-60`;

/**
 * Kajabi's "Video actions" menu on a lesson. What only reads works (video stats, a link to the lesson
 * at the playhead); what edits the video or needs something we don't have yet is disabled with the
 * reason on hover.
 */
export default function VideoActions({
  statsHref,
  lessonUrl,
  seconds = 0,
}: {
  /** The lesson's watch stats; null when the lesson has no video in the Hub. */
  statsHref: string | null;
  /** The lesson's address for members, or null before the lesson is in the Hub. */
  lessonUrl: string | null;
  /** Where the player is, to the second. */
  seconds?: number;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function copyTimestampUrl() {
    if (!lessonUrl) return;
    try {
      await navigator.clipboard.writeText(seconds > 0 ? `${lessonUrl}?t=${seconds}` : lessonUrl);
      setStatus(seconds > 0 ? `Copied a link to ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}.` : "Copied a link to the lesson.");
    } catch {
      setStatus("Couldn't copy the link.");
    }
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium dark:border-slate-600"
      >
        Video actions ▾
      </button>
      {open && (
        <div role="menu" aria-label="Video actions" className="absolute left-0 z-10 mt-1 w-64 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {statsHref ? (
            <Link role="menuitem" href={statsHref} className={`${ITEM} hover:bg-slate-50 dark:hover:bg-slate-800`}>
              Video stats
            </Link>
          ) : (
            <button type="button" role="menuitem" disabled title="This lesson's video isn't in the Hub yet" className={OFF}>
              Video stats
            </button>
          )}
          <button type="button" role="menuitem" disabled title={`${SOON} (the captions and transcript manager)`} className={OFF}>
            Closed captions
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={copyTimestampUrl}
            disabled={!lessonUrl}
            title={lessonUrl ? undefined : "This lesson isn't in the Hub yet"}
            className={lessonUrl ? `${ITEM} hover:bg-slate-50 dark:hover:bg-slate-800` : OFF}
          >
            Copy timestamp URL
          </button>
          <button type="button" role="menuitem" disabled title="Lesson thumbnails are private to signed-in members, so a link can't show one to everyone yet" className={OFF}>
            Copy link with thumbnail
          </button>
          <button type="button" role="menuitem" disabled title="Needs downloadable (MP4) copies of the video turned on in Mux, which has a cost" className={OFF}>
            Download video
          </button>
          <div role="separator" className="my-1 border-t border-slate-200 dark:border-slate-700" />
          <button type="button" role="menuitem" disabled title={SOON} className={`${OFF} text-red-700 dark:text-red-300`}>
            Remove video
          </button>
        </div>
      )}
      {status && (
        <p role="status" className="mt-2 text-xs text-slate-600 dark:text-slate-400">
          {status}
        </p>
      )}
    </div>
  );
}
