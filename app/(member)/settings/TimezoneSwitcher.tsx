"use client";

import { useState, useEffect } from "react";
import { updateTimezonePreference } from "./actions";

/**
 * Timezone preference switcher
 *
 * Note: Timezone is stored in the database (user-level preference) for cross-device consistency.
 * Users should see times in their preferred timezone on all devices.
 *
 * There's no "auto-detect" choice: TimezoneInitializer saves the browser's zone the first time a
 * member opens the app, and offers to update it when they travel. "browser" is only what's stored
 * until then, so it shows here as the detected zone.
 *
 * Compare with ThemeSwitcher which stores in localStorage for device-specific preferences.
 */
interface TimezoneSwitcherProps {
  initialTimezone?: string;
}

// Common timezones grouped by region
export const TIMEZONES = [
  { value: "separator-us", label: "─── United States ───", disabled: true },
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Phoenix", label: "Arizona (no DST)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Anchorage", label: "Alaska Time (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (HST)" },
  { value: "separator-americas", label: "─── Americas ───", disabled: true },
  { value: "America/Toronto", label: "Toronto" },
  { value: "America/Vancouver", label: "Vancouver" },
  { value: "America/Mexico_City", label: "Mexico City" },
  { value: "America/Sao_Paulo", label: "São Paulo" },
  { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires" },
  { value: "separator-europe", label: "─── Europe ───", disabled: true },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Paris", label: "Paris (CET/CEST)" },
  { value: "Europe/Berlin", label: "Berlin (CET/CEST)" },
  { value: "Europe/Rome", label: "Rome (CET/CEST)" },
  { value: "Europe/Madrid", label: "Madrid (CET/CEST)" },
  { value: "Europe/Amsterdam", label: "Amsterdam (CET/CEST)" },
  { value: "Europe/Stockholm", label: "Stockholm (CET/CEST)" },
  { value: "Europe/Warsaw", label: "Warsaw (CET/CEST)" },
  { value: "Europe/Athens", label: "Athens (EET/EEST)" },
  { value: "Europe/Moscow", label: "Moscow (MSK)" },
  { value: "separator-asia", label: "─── Asia & Pacific ───", disabled: true },
  { value: "Asia/Dubai", label: "Dubai (GST)" },
  { value: "Asia/Kolkata", label: "India (IST)" },
  { value: "Asia/Shanghai", label: "Beijing/Shanghai (CST)" },
  { value: "Asia/Hong_Kong", label: "Hong Kong (HKT)" },
  { value: "Asia/Singapore", label: "Singapore (SGT)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
  { value: "Asia/Seoul", label: "Seoul (KST)" },
  { value: "Australia/Sydney", label: "Sydney (AEDT/AEST)" },
  { value: "Australia/Melbourne", label: "Melbourne (AEDT/AEST)" },
  { value: "Pacific/Auckland", label: "Auckland (NZDT/NZST)" },
];

export function TimezoneSwitcher({ initialTimezone = "browser" }: TimezoneSwitcherProps) {
  const [timezone, setTimezone] = useState(initialTimezone);
  const [browserTimezone, setBrowserTimezone] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // The saved zone can change under us (the "Change time zone?" prompt saves it, then the page refreshes).
  const [seenInitial, setSeenInitial] = useState(initialTimezone);
  if (seenInitial !== initialTimezone) {
    setSeenInitial(initialTimezone);
    setTimezone(initialTimezone);
  }

  useEffect(() => {
    // Detect browser timezone
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setBrowserTimezone(detected);
  }, []);

  const handleChange = async (newTimezone: string) => {
    setTimezone(newTimezone);
    setSaving(true);

    const result = await updateTimezonePreference(newTimezone);

    if (result.error) {
      console.error("Failed to save timezone:", result.error);
      // Revert on error
      setTimezone(initialTimezone);
    }

    setSaving(false);
  };

  // Nothing saved yet ("browser"): show the zone the browser reports.
  const current = timezone === "browser" ? browserTimezone : timezone;
  // A zone that isn't in the list still needs an option: the selected one (set elsewhere), and the
  // browser's own, so the zone the "Change time zone?" prompt saves can always be picked again.
  const extras = [...new Set([current, browserTimezone])]
    .filter((zone) => zone && !TIMEZONES.some((tz) => tz.value === zone))
    .map((zone) => ({ value: zone, label: `${zone.replace(/_/g, " ")}${zone === browserTimezone ? " (current location)" : ""}` }));
  const options = [...extras, ...TIMEZONES];

  return (
    <div>
      <label
        htmlFor="timezone"
        className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
      >
        Default Timezone
      </label>
      <select
        id="timezone"
        data-track="settings-timezone"
        value={current}
        onChange={(e) => handleChange(e.target.value)}
        disabled={saving || !current}
        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-plum-500 focus:border-transparent disabled:opacity-50"
      >
        {options.map((tz) =>
          "disabled" in tz && tz.disabled ? (
            <option key={tz.value} disabled className="text-slate-400 dark:text-slate-500">
              {tz.label}
            </option>
          ) : (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          )
        )}
      </select>
      {browserTimezone && current !== browserTimezone && (
        <button
          type="button"
          onClick={() => handleChange(browserTimezone)}
          data-track="settings-timezone-use-browser"
          disabled={saving}
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-plum-600 hover:underline disabled:opacity-50 dark:text-plum-400"
        >
          {/* The usual "my location" crosshair. */}
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="3" />
            <circle cx="12" cy="12" r="7" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
          Use current location ({browserTimezone.replace(/_/g, " ")})
        </button>
      )}
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        All times will display in: <span className="font-medium">{current || "Detecting..."}</span>
        {saving && <span className="ml-2 italic">Saving...</span>}
      </p>
    </div>
  );
}
