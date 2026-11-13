"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { OPEN_SHARE_PARAM, OPEN_SHARE_VALUE } from "@/lib/chat/lesson-links";

const SOON = "Not available yet: courses are imported from Kajabi for now";
const ITEM = "flex w-full items-center gap-3 px-4 py-2 text-left text-sm";
const OFF = `${ITEM} cursor-not-allowed opacity-60`;

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Kajabi's "Video actions" menu on a lesson. What only reads works (video stats, a link to the lesson
 * at the playhead); what edits the video or needs something we don't have yet is disabled with the
 * reason on hover.
 */
export default function VideoActions({
  statsHref,
  lessonUrl,
  seconds = 0,
  thumbnailLink,
  thumbnailLinkBlocked,
  chatShare = false,
}: {
  /** The lesson's watch stats; null when the lesson has no video in the Hub. */
  statsHref: string | null;
  /** The lesson's address for members, or null before the lesson is in the Hub. */
  lessonUrl: string | null;
  /** Where the player is, to the second. */
  seconds?: number;
  /** The lesson's address and a picture anyone can load, when the lesson is public (lib/courses/public-preview.ts). */
  thumbnailLink?: { url: string; imageUrl: string; title: string } | null;
  /** Why there is no thumbnail link, shown on hover. */
  thumbnailLinkBlocked?: string;
  /** Offer the "open to everyone" link (the `chat_videos` feature is on for this admin). */
  chatShare?: boolean;
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

  /** The lesson's address, with the player's position when it has moved. Pasted into a Hub Chat message it becomes the video card (docs/SLACK_BRIDGED_CHAT.md, "Paste a lesson link, anywhere"). */
  async function copyLink() {
    if (!lessonUrl) return;
    try {
      await navigator.clipboard.writeText(seconds > 0 ? `${lessonUrl}?t=${seconds}` : lessonUrl);
      const at = seconds > 0 ? ` at ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "";
      setStatus(chatShare ? `Copied the link${at}. Paste it into Hub Chat to share the video there.` : `Copied the link${at}.`);
    } catch {
      setStatus("Couldn't copy the link.");
    }
    setOpen(false);
  }

  /** The same address with the marker that lets everyone in the conversation play it without the course; it only counts when an admin sends it. */
  async function copyOpenLink() {
    if (!lessonUrl) return;
    try {
      await navigator.clipboard.writeText(`${lessonUrl}?${OPEN_SHARE_PARAM}=${OPEN_SHARE_VALUE}`);
      setStatus("Copied. Paste it into Hub Chat: everyone in that conversation can watch the video, even without the course.");
    } catch {
      setStatus("Couldn't copy the link.");
    }
    setOpen(false);
  }

  /** The lesson's address as a clickable picture (rich text, for an email or a document), with the plain address as the fallback. */
  async function copyLinkWithThumbnail() {
    if (!thumbnailLink) return;
    const { url, imageUrl, title } = thumbnailLink;
    const html = `<a href="${escapeHtml(url)}"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" width="480"></a>`;
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([url], { type: "text/plain" }) })]);
      } else {
        await navigator.clipboard.writeText(url);
      }
      setStatus("Copied a link with the thumbnail.");
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
            onClick={copyLink}
            disabled={!lessonUrl}
            title={lessonUrl ? undefined : "This lesson isn't in the Hub yet"}
            className={lessonUrl ? `${ITEM} hover:bg-slate-50 dark:hover:bg-slate-800` : OFF}
          >
            Copy link
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={copyLinkWithThumbnail}
            disabled={!thumbnailLink}
            title={thumbnailLink ? undefined : thumbnailLinkBlocked}
            className={thumbnailLink ? `${ITEM} hover:bg-slate-50 dark:hover:bg-slate-800` : OFF}
          >
            Copy with thumbnail
          </button>
          {chatShare && (
              <button
                type="button"
                role="menuitem"
                onClick={copyOpenLink}
                disabled={!lessonUrl}
                title={lessonUrl ? "Everyone in the conversation can watch it, even without the course" : "This lesson isn't in the Hub yet"}
                className={lessonUrl ? `${ITEM} hover:bg-slate-50 dark:hover:bg-slate-800` : OFF}
              >
                Copy link, open to everyone
              </button>
          )}
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
