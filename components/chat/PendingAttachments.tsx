"use client";

import { useEffect, useState } from "react";
import ImageLightbox from "@/components/ImageLightbox";
import { formatFileSize } from "@/lib/chat/files";

/**
 * The files waiting to be sent, shown inside the composer box: a thumbnail for each image (click
 * to enlarge), a chip with the name for anything else, and a small x on hover to take one away.
 */
export default function PendingAttachments({
  files,
  progress,
  disabled,
  onRemove,
}: {
  files: File[];
  /** Upload progress per file (0 to 1) while sending: a ring over each file. */
  progress?: number[];
  disabled?: boolean;
  onRemove: (index: number) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [urls, setUrls] = useState<(string | null)[]>([]);
  useEffect(() => {
    const made = files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null));
    setUrls(made);
    return () => made.forEach((u) => u && URL.revokeObjectURL(u));
  }, [files]);

  const images = files.flatMap((f, i) => (urls[i] ? [{ src: urls[i]!, name: f.name || "image", fileIndex: i }] : []));
  const remove = (i: number) => (
    <button
      type="button"
      aria-label={`Remove ${files[i].name || "file"}`}
      disabled={disabled}
      onClick={() => onRemove(i)}
      className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-xs text-white group-focus-within:flex group-hover:flex"
    >
      ✕
    </button>
  );

  return (
    <>
      <ul className="flex flex-wrap gap-2 px-2 pt-2" aria-label="Attached files">
        {files.map((f, i) => {
          const url = urls[i];
          return (
            <li key={`${f.name}-${i}`} className="group relative">
              {url && url.startsWith("blob:") ? (
                <button
                  type="button"
                  aria-label={`Preview ${f.name || "image"}`}
                  onClick={() => setOpen(images.findIndex((img) => img.fileIndex === i))}
                  className="block overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL */}
                  <img src={url} alt="" className="h-16 w-16 object-cover" />
                </button>
              ) : (
                <div className="flex h-16 max-w-48 flex-col justify-center rounded-lg border border-slate-200 px-3 text-xs dark:border-slate-700">
                  <span className="truncate font-medium">{f.name || "file"}</span>
                  <span className="text-slate-600 dark:text-slate-400">{formatFileSize(f.size)}</span>
                </div>
              )}
              {progress && <ProgressRing fraction={progress[i] ?? 0} name={f.name || "file"} />}
              {remove(i)}
            </li>
          );
        })}
      </ul>
      {open !== null && open >= 0 && <ImageLightbox images={images} startIndex={open} onClose={() => setOpen(null)} />}
    </>
  );
}

const RING_R = 14;
const RING_LENGTH = 2 * Math.PI * RING_R;

/** A dimmed overlay with a ring that fills as the file uploads. */
function ProgressRing({ fraction, name }: { fraction: number; name: string }) {
  const pct = Math.round(fraction * 100);
  return (
    <div role="progressbar" aria-label={`Uploading ${name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="absolute inset-0 flex items-center justify-center rounded-lg bg-slate-900/50">
      <svg viewBox="0 0 32 32" className="h-9 w-9 -rotate-90" aria-hidden>
        <circle cx="16" cy="16" r={RING_R} fill="none" stroke="currentColor" strokeWidth="3" className="text-white/30" />
        <circle cx="16" cy="16" r={RING_R} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={RING_LENGTH} strokeDashoffset={RING_LENGTH * (1 - fraction)} className="text-white" />
      </svg>
    </div>
  );
}
