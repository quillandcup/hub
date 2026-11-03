"use client";

import { useEffect, useState } from "react";
import ImageLightbox from "@/components/ImageLightbox";
import { formatFileSize } from "@/lib/chat/files";

/**
 * The files waiting to be sent, shown inside the composer box: a thumbnail for each image (click
 * to enlarge), a chip with the name for anything else, and a small x on hover to take one away.
 * `kept` are files already uploaded (a draft's, which come back with a link to preview them); they
 * come first, and `files` are ones still in the browser.
 */
export interface KeptAttachment {
  name: string;
  size: number;
  /** A link to the image to preview it; null for anything that isn't one (or when none could be made). */
  url: string | null;
}

export default function PendingAttachments({
  files,
  kept = [],
  progress,
  disabled,
  onRemove,
  onRemoveKept,
}: {
  files: File[];
  kept?: KeptAttachment[];
  onRemoveKept?: (index: number) => void;
  /** Upload progress per file in `files` (0 to 1): a ring over each one, except those given null. */
  progress?: (number | null)[];
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

  // Kept files first, then the ones in the browser; each remembers which list it is from.
  const items = [
    ...kept.map((k, i) => ({ key: `kept-${k.name}-${i}`, name: k.name, size: k.size, url: k.url && /^(https?:|blob:)/i.test(k.url) ? k.url : null, kind: "kept" as const, index: i })),
    ...files.map((f, i) => ({ key: `${f.name}-${i}`, name: f.name, size: f.size, url: urls[i]?.startsWith("blob:") ? urls[i] : null, kind: "file" as const, index: i })),
  ];
  const images = items.flatMap((it, n) => (it.url ? [{ src: it.url, name: it.name || "image", itemIndex: n }] : []));

  return (
    <>
      <ul className="flex flex-wrap gap-2 px-2 pt-2" aria-label="Attached files">
        {items.map((it, n) => (
          <li key={it.key} className="group relative">
            {it.url ? (
              <button
                type="button"
                aria-label={`Preview ${it.name || "image"}`}
                onClick={() => setOpen(images.findIndex((img) => img.itemIndex === n))}
                className="block overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a blob: or signed storage URL */}
                <img src={it.url} alt="" className="h-16 w-16 object-cover" />
              </button>
            ) : (
              <div className="flex h-16 max-w-48 flex-col justify-center rounded-lg border border-slate-200 px-3 text-xs dark:border-slate-700">
                <span className="truncate font-medium">{it.name || "file"}</span>
                <span className="text-slate-600 dark:text-slate-400">{formatFileSize(it.size)}</span>
              </div>
            )}
            {it.kind === "file" && progress && progress[it.index] !== null && <ProgressRing fraction={progress[it.index] ?? 0} name={it.name || "file"} />}
            <button
              type="button"
              aria-label={`Remove ${it.name || "file"}`}
              disabled={disabled}
              onClick={() => (it.kind === "kept" ? onRemoveKept?.(it.index) : onRemove(it.index))}
              className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-xs text-white group-focus-within:flex group-hover:flex"
            >
              ✕
            </button>
          </li>
        ))}
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
