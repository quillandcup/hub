import { useEffect } from "react";

/** The id Puck gives the canvas iframe. */
const FRAME_ID = "preview-frame";
const ATTRIBUTES = ["class", "style"] as const;

/** Copies the host page's `<html>` class and style (next-themes' `dark` and `color-scheme`) onto the canvas iframe's own `<html>`. */
export function mirrorHostTheme(host: Document = document) {
  const frameHtml = (host.getElementById(FRAME_ID) as HTMLIFrameElement | null)?.contentDocument?.documentElement;
  if (!frameHtml) return;
  for (const name of ATTRIBUTES) {
    const value = host.documentElement.getAttribute(name);
    if (value === null) frameHtml.removeAttribute(name);
    else if (frameHtml.getAttribute(name) !== value) frameHtml.setAttribute(name, value);
  }
}

/**
 * Puck copies the host's `<html>` attributes into the canvas iframe once, when it mounts, so a theme change afterwards
 * (the person picks another one, or the system flips between light and dark) updates the editor's chrome but leaves the
 * page being edited in the old theme until a reload. This keeps the two in step.
 */
export function useMirrorHostTheme() {
  useEffect(() => {
    const observer = new MutationObserver(() => mirrorHostTheme());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [...ATTRIBUTES] });
    mirrorHostTheme();
    return () => observer.disconnect();
  }, []);
}
