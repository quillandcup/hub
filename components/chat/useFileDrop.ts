"use client";

import { useEffect, useState } from "react";

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

/**
 * Accept files dragged onto an element. `target` returns the element to watch (the conversation
 * column, the thread panel); `dragging` is true while files are over it, with `rect` its box, so a
 * caller can draw an overlay on top without needing the element to be positioned.
 */
export function useFileDrop(target: () => HTMLElement | null, onFiles: (files: File[]) => void, enabled = true) {
  const [state, setState] = useState<{ rect: DOMRect } | null>(null);

  useEffect(() => {
    const el = enabled ? target() : null;
    if (!el) return;
    let depth = 0;
    const end = () => {
      depth = 0;
      setState(null);
    };
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setState({ rect: el.getBoundingClientRect() });
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setState(null);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      end();
      if (files.length > 0) onFiles(files);
    };
    el.addEventListener("dragenter", enter);
    el.addEventListener("dragover", over);
    el.addEventListener("dragleave", leave);
    el.addEventListener("drop", drop);
    window.addEventListener("dragend", end);
    return () => {
      el.removeEventListener("dragenter", enter);
      el.removeEventListener("dragover", over);
      el.removeEventListener("dragleave", leave);
      el.removeEventListener("drop", drop);
      window.removeEventListener("dragend", end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- target is read once per mount
  }, [enabled, onFiles]);

  return { dragging: state !== null, rect: state?.rect ?? null };
}
