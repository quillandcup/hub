"use client";

import { useEffect, useState } from "react";

export type LightboxImage = { src: string; name?: string };

/**
 * A full-size view of one image from a list, over the page. Escape or a click on the backdrop
 * closes it; the arrow keys and buttons step through the list. The caller decides when it is open
 * (render it, or don't) and gets `onClose`.
 */
export default function ImageLightbox({ images, startIndex = 0, onClose }: { images: LightboxImage[]; startIndex?: number; onClose: () => void }) {
  const [index, setIndex] = useState(Math.min(Math.max(startIndex, 0), Math.max(images.length - 1, 0)));
  const count = images.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, count - 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, count]);

  const image = images[index];
  if (!image) return null;
  const src = image.src;
  if (!(src.startsWith("blob:") || src.startsWith("https://") || (src.startsWith("/") && !src.startsWith("//")))) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label={image.name ?? "Image preview"} className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a blob: or private-storage URL */}
      <img src={src} alt={image.name ?? ""} onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full rounded object-contain" />
      <button type="button" aria-label="Close preview" data-track-ignore onClick={onClose} className="absolute right-4 top-4 rounded-full bg-black/60 px-3 py-1 text-white hover:bg-black/80">
        ✕
      </button>
      {count > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous image"
            data-track-ignore
            disabled={index === 0}
            onClick={(e) => {
              e.stopPropagation();
              setIndex(index - 1);
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-3 py-2 text-white hover:bg-black/80 disabled:opacity-30"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next image"
            data-track-ignore
            disabled={index === count - 1}
            onClick={(e) => {
              e.stopPropagation();
              setIndex(index + 1);
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-3 py-2 text-white hover:bg-black/80 disabled:opacity-30"
          >
            ›
          </button>
        </>
      )}
    </div>
  );
}
