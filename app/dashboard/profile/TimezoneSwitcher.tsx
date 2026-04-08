"use client";

import { useState, useEffect } from "react";
import { updateTimezonePreference } from "./actions";

interface TimezoneSwitcherProps {
  initialTimezone?: string;
}

// Common timezones grouped by region
const TIMEZONES = [
  { value: "browser", label: "Browser/Local Time (Auto-detect)" },
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

  const getCurrentTimezone = () => {
    if (timezone === "browser") {
      return browserTimezone || "Detecting...";
    }
    return timezone;
  };

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
        value={timezone}
        onChange={(e) => handleChange(e.target.value)}
        disabled={saving}
        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
      >
        {TIMEZONES.map((tz) =>
          tz.disabled ? (
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
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        {timezone === "browser" ? (
          <>
            Using your browser's timezone: <span className="font-medium">{getCurrentTimezone()}</span>
          </>
        ) : (
          <>
            All times will display in: <span className="font-medium">{getCurrentTimezone()}</span>
          </>
        )}
        {saving && <span className="ml-2 italic">Saving...</span>}
      </p>
    </div>
  );
}
