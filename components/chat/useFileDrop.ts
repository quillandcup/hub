"use client";

import { useEffect, useState } from "react";

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

/**
 * Accept files dragged onto one or more elements. `targets` returns the elements to watch (the
 * conversation column, a side panel; missing ones are skipped); `dragging` is true while files are
 * over one of them, with `rect` the box of the one they are over, so a caller can draw an overlay on
 * top without needing the element to be positioned.
 */
type Target = HTMLElement | null;
export function useFileDrop(targets: () => Target | Target[], onFiles: (files: File[]) => void, enabled = true) {
  const [state, setState] = useState<{ rect: DOMRect } | null>(null);

  useEffect(() => {
    const found = enabled ? targets() : null;
    const els = (Array.isArray(found) ? found : [found]).filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const depths = new Map<HTMLElement, number>();
    const end = () => {
      depths.clear();
      setState(null);
    };
    const cleanups = els.map((el) => {
      const enter = (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depths.set(el, (depths.get(el) ?? 0) + 1);
        setState({ rect: el.getBoundingClientRect() });
      };
      const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
      const leave = (e: DragEvent) => {
        if (!hasFiles(e)) return;
        const depth = Math.max(0, (depths.get(el) ?? 0) - 1);
        depths.set(el, depth);
        if (depth === 0) setState(null);
      };
      const drop = (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        const files = Array.from(e.dataTransfer!.files);
        end();
        if (files.length > 0) onFiles(files);
      };
      el.addEventListener("dragenter", enter);
      el.addEventListener("dragover", over);
      el.addEventListener("dragleave", leave);
      el.addEventListener("drop", drop);
      return () => {
        el.removeEventListener("dragenter", enter);
        el.removeEventListener("dragover", over);
        el.removeEventListener("dragleave", leave);
        el.removeEventListener("drop", drop);
      };
    });
    window.addEventListener("dragend", end);
    return () => {
      cleanups.forEach((c) => c());
      window.removeEventListener("dragend", end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targets are read once per mount
  }, [enabled, onFiles]);

  return { dragging: state !== null, rect: state?.rect ?? null };
}
