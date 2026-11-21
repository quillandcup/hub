"use client";

import { useEffect, useState } from "react";
import { ANIMATIONS_CHANGED_EVENT } from "@/components/AnimationsController";
import { track } from "@/lib/analytics/client";
import { ANIMATIONS_STORAGE_KEY, animationsChoice, type AnimationsChoice } from "@/lib/animations";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Animations preference, one choice like the theme: System (follows the device's "reduce motion" setting),
 * Allow, or Reduce (GIFs and animated emoji show as still images, and the app's own motion stops).
 * Stored on this device, like the theme; System stores nothing.
 */
export function AnimationsSwitcher() {
  const [choice, setChoice] = useState<AnimationsChoice | null>(null);
  const [deviceReduces, setDeviceReduces] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(REDUCED_MOTION);
    const read = () => {
      setChoice(animationsChoice(localStorage.getItem(ANIMATIONS_STORAGE_KEY)));
      setDeviceReduces(media.matches);
    };
    read();
    media.addEventListener("change", read);
    return () => media.removeEventListener("change", read);
  }, []);

  // Avoid a hydration mismatch by only rendering once the stored choice is known.
  if (choice === null) return <div className="h-16 animate-pulse rounded-md bg-slate-200 dark:bg-slate-700" />;

  const change = (next: AnimationsChoice) => {
    track("animations_setting_changed", { choice: next, device_reduces_motion: deviceReduces });
    setChoice(next);
    if (next === "system") localStorage.removeItem(ANIMATIONS_STORAGE_KEY);
    else localStorage.setItem(ANIMATIONS_STORAGE_KEY, next);
    window.dispatchEvent(new Event(ANIMATIONS_CHANGED_EVENT));
  };

  return (
    <div>
      <label htmlFor="animations" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
        Animations
      </label>
      <select
        id="animations"
        data-track="settings-animations"
        value={choice}
        onChange={(e) => change(e.target.value as AnimationsChoice)}
        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-plum-500 focus:border-transparent"
      >
        <option value="system">System (Auto)</option>
        <option value="allow">Allow animations</option>
        <option value="reduce">Reduce animations</option>
      </select>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        {choice === "system"
          ? `Follows your device's reduce motion setting (currently ${deviceReduces ? "on, so GIFs and emoji are still" : "off, so they move"})`
          : choice === "allow"
            ? "GIFs, animated emoji and other motion play"
            : "GIFs and animated emoji are still images (tap a GIF to play it) and other motion stops"}
      </p>
    </div>
  );
}
