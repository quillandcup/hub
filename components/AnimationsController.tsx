"use client";

import { useEffect, useState } from "react";
import { ANIMATIONS_STORAGE_KEY, animationsAllowed, looksAnimated } from "@/lib/animations";

/** Fired on window when the setting changes in this tab (the `storage` event only reaches other tabs). */
export const ANIMATIONS_CHANGED_EVENT = "hub-animations-changed";

const FROZEN = "data-frozen-src";

/** Replace a moving image with its first frame; when the browser won't let us read it, with its alt text. */
function freeze(img: HTMLImageElement) {
  if (img.hasAttribute(FROZEN) || img.hasAttribute("data-playing")) return;
  const original = img.currentSrc || img.src;
  if (!original || !(img.hasAttribute("data-animated") || looksAnimated(original))) return;
  img.setAttribute(FROZEN, original);

  const probe = new Image();
  probe.crossOrigin = "anonymous";
  probe.onload = () => {
    if (img.getAttribute(FROZEN) !== original) return; // animations came back meanwhile
    try {
      const canvas = document.createElement("canvas");
      canvas.width = probe.naturalWidth;
      canvas.height = probe.naturalHeight;
      canvas.getContext("2d")?.drawImage(probe, 0, 0);
      img.src = canvas.toDataURL("image/png");
    } catch {
      hide(img);
    }
  };
  // A host without CORS headers can't be drawn: show the alt text (":name:") instead of a moving image.
  probe.onerror = () => {
    if (img.getAttribute(FROZEN) === original) hide(img);
  };
  probe.src = original;
}

const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

function hide(img: HTMLImageElement) {
  // An attachment keeps its tile (and its play button) over a blank frame; an emoji falls back to its alt text.
  if (img.hasAttribute("data-animated")) img.src = BLANK;
  else img.removeAttribute("src");
}

function thaw(img: HTMLImageElement) {
  const original = img.getAttribute(FROZEN);
  if (!original) return;
  img.removeAttribute(FROZEN);
  // The attribute is DOM text: only restore a plain http(s) address, never a javascript: or other scheme.
  const url = new URL(original, window.location.href);
  if (url.protocol === "http:" || url.protocol === "https:") img.src = url.href;
}

function eachImage(root: ParentNode, fn: (img: HTMLImageElement) => void) {
  if (root instanceof HTMLImageElement) fn(root);
  else root.querySelectorAll("img").forEach(fn);
}

/**
 * Applies the member's "Allow animations" setting: `data-animations="off"` on <html> (CSS stops
 * transitions and keyframe animations, see globals.css) and a still first frame for GIFs and other
 * animated images, including ones that arrive later (chat loads as you scroll).
 */
export function AnimationsController() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let observer: MutationObserver | null = null;

    const apply = () => {
      const allowed = animationsAllowed(localStorage.getItem(ANIMATIONS_STORAGE_KEY), media.matches);
      document.documentElement.dataset.animations = allowed ? "on" : "off";
      observer?.disconnect();
      observer = null;
      if (allowed) {
        eachImage(document, thaw);
        return;
      }
      eachImage(document, freeze);
      observer = new MutationObserver((records) => {
        for (const r of records) {
          r.addedNodes.forEach((n) => n instanceof Element && eachImage(n, freeze));
          if (r.type === "attributes" && r.attributeName === "data-playing" && r.target instanceof HTMLImageElement) {
            // Click-to-play on a still image (see MessageFiles): play thaws it, pause freezes it again.
            if (r.target.hasAttribute("data-playing")) thaw(r.target);
            else freeze(r.target);
          } else if (r.type === "attributes" && r.target instanceof HTMLImageElement) {
            // React reusing an <img> for another source: freeze the new one.
            const img = r.target;
            if (img.getAttribute(FROZEN) !== img.src && !img.src.startsWith("data:")) {
              img.removeAttribute(FROZEN);
              freeze(img);
            }
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "data-playing"] });
    };

    apply();
    window.addEventListener("storage", apply);
    window.addEventListener(ANIMATIONS_CHANGED_EVENT, apply);
    media.addEventListener("change", apply);
    return () => {
      observer?.disconnect();
      window.removeEventListener("storage", apply);
      window.removeEventListener(ANIMATIONS_CHANGED_EVENT, apply);
      media.removeEventListener("change", apply);
    };
  }, []);

  return null;
}

/** Whether animations are currently off, following the setting live. */
export function useAnimationsOff(): boolean {
  const [off, setOff] = useState(false);
  useEffect(() => {
    const read = () => setOff(document.documentElement.dataset.animations === "off");
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-animations"] });
    return () => observer.disconnect();
  }, []);
  return off;
}
