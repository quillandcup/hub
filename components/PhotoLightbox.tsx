"use client";

import { useEffect } from "react";

export interface LightboxPhoto {
  id: string;
  src: string;
  alt?: string;
}

interface PhotoLightboxProps {
  photos: LightboxPhoto[];
  openIndex: number | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

/**
 * Full-viewport "click a thumbnail, see it full-screen" overlay, with
 * prev/next between photos. Same overlay/Escape-to-close approach as the
 * single-screenshot lightbox in app/(admin)/admin/feedback/FeedbackClient.tsx,
 * factored out here since both the admin and member event photo grids need
 * it, plus prev/next navigation neither needed for a single image.
 */
export default function PhotoLightbox({ photos, openIndex, onClose, onNavigate }: PhotoLightboxProps) {
  const isOpen = openIndex !== null;
  const current = isOpen ? photos[openIndex] : null;

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && openIndex! > 0) onNavigate(openIndex! - 1);
      else if (e.key === "ArrowRight" && openIndex! < photos.length - 1) onNavigate(openIndex! + 1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, openIndex, photos.length, onClose, onNavigate]);

  if (!isOpen || !current) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-8"
      onClick={onClose}
    >
      {openIndex! > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(openIndex! - 1);
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white text-4xl leading-none p-2"
          aria-label="Previous photo"
        >
          ‹
        </button>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element -- served via the private event-photos proxy route, not a static/optimizable asset */}
      <img
        src={current.src}
        alt={current.alt || ""}
        className="max-w-full max-h-full rounded shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />

      {openIndex! < photos.length - 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(openIndex! + 1);
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white text-4xl leading-none p-2"
          aria-label="Next photo"
        >
          ›
        </button>
      )}

      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/80 hover:text-white text-2xl leading-none p-2"
        aria-label="Close"
      >
        ✕
      </button>
    </div>
  );
}
