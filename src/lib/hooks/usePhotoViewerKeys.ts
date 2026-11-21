"use client";

import { useEffect, useRef } from "react";
import { useRegisterShortcuts } from "@/components/shortcuts/ShortcutsProvider";
import { hasCommandModifier, isTypingTarget } from "@/lib/keyboard";

/**
 * Left and Right step through the photos of a full-size viewer (`ImageLightbox`, `PhotoLightbox`), listed in the `?`
 * panel as "Photo viewer" (`src/lib/shortcuts.ts`) while a viewer is mounted and `active`. The viewer is itself a dialog, so
 * the overlay guard of `src/lib/keyboard.ts` does not apply; typing and held modifiers (Alt+Left is the browser's Back) do.
 */
export default function usePhotoViewerKeys({ onPrevious, onNext, active = true }: { onPrevious: () => void; onNext: () => void; active?: boolean }): void {
  useRegisterShortcuts("photoViewer", { active });
  const handlers = useRef({ onPrevious, onNext });
  useEffect(() => {
    handlers.current = { onPrevious, onNext };
  });

  useEffect(() => {
    if (!active) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || hasCommandModifier(e) || isTypingTarget(e.target)) return;
      if (e.key === "ArrowLeft") handlers.current.onPrevious();
      else if (e.key === "ArrowRight") handlers.current.onNext();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active]);
}
