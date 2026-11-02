"use client";

import { useEffect, useState } from "react";
import { ANIMATIONS_CHANGED_EVENT } from "@/components/AnimationsController";
import { track } from "@/lib/analytics/client";
import { ANIMATIONS_STORAGE_KEY, animationsAllowed } from "@/lib/animations";

/**
 * "Allow animations": off shows GIFs and animated emoji as a still image and stops the app's own
 * motion. Stored on this device (like the theme); until chosen it follows the device's "reduce motion".
 */
export function AnimationsToggle() {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    setAllowed(
      animationsAllowed(localStorage.getItem(ANIMATIONS_STORAGE_KEY), window.matchMedia("(prefers-reduced-motion: reduce)").matches),
    );
  }, []);

  if (allowed === null) return <div className="h-12 animate-pulse rounded-md bg-slate-200 dark:bg-slate-700" />;

  const change = (next: boolean) => {
    track("animations_setting_changed", {
      allowed: next,
      was_default_off: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
    setAllowed(next);
    localStorage.setItem(ANIMATIONS_STORAGE_KEY, next ? "on" : "off");
    window.dispatchEvent(new Event(ANIMATIONS_CHANGED_EVENT));
  };

  return (
    <div className="flex items-start gap-3">
      <input
        id="allow-animations"
        type="checkbox"
        data-track="settings-animations"
        checked={allowed}
        onChange={(e) => change(e.target.checked)}
        className="mt-1 h-4 w-4 rounded border-slate-300 text-plum-600 focus:ring-plum-500"
      />
      <label htmlFor="allow-animations" className="text-sm">
        <span className="block font-medium text-slate-700 dark:text-slate-300">Allow animations</span>
        <span className="block text-slate-600 dark:text-slate-400">
          Applies to emoji, GIFs and other motion across the Hub. Turn off to see still images. Saved on this device.
        </span>
      </label>
    </div>
  );
}
