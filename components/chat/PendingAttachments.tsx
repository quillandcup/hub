"use client";

import { useEffect, useMemo, useState } from "react";
import ImageLightbox from "@/components/ImageLightbox";
import { formatFileSize } from "@/lib/chat/files";

/**
 * The files waiting to be sent, shown inside the composer box: a thumbnail for each image (click
 * to enlarge), a chip with the name for anything else, and a small x on hover to take one away.
 */
export default function PendingAttachments({ files, disabled, onRemove }: { files: File[]; disabled?: boolean; onRemove: (index: number) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const urls = useMemo(() => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);

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
                  <span className="text-slate-500 dark:text-slate-400">{formatFileSize(f.size)}</span>
                </div>
              )}
              {remove(i)}
            </li>
          );
        })}
      </ul>
      {open !== null && open >= 0 && <ImageLightbox images={images} startIndex={open} onClose={() => setOpen(null)} />}
    </>
  );
}
