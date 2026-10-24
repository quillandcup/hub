"use client";

import { useState } from "react";
import { ORG_TIMEZONE } from "@/lib/config";
import { updateSecondaryTimezone } from "./actions";
import { TIMEZONES } from "./TimezoneSwitcher";

/**
 * Optional secondary time zone (the Settings one is the primary), shown in parentheses beside the member's own on prickle times
 * ("4:00 AM (7:00 AM ET)"), like Google Calendar's additional time zone. Off until they turn it on;
 * turning it on starts at the org's zone, since that is how prickles are announced.
 */
export function SecondaryTimezoneSwitcher({ initialTimezone }: { initialTimezone: string | null }) {
  const [timezone, setTimezone] = useState<string | null>(initialTimezone);
  const [saving, setSaving] = useState(false);

  const save = async (next: string | null) => {
    const previous = timezone;
    setTimezone(next);
    setSaving(true);
    const result = await updateSecondaryTimezone(next);
    if (result.error) {
      console.error("Failed to save secondary timezone:", result.error);
      setTimezone(previous);
    }
    setSaving(false);
  };

  const options = TIMEZONES.some((tz) => tz.value === timezone) || !timezone
    ? TIMEZONES
    : [{ value: timezone, label: timezone.replace(/_/g, " ") }, ...TIMEZONES];

  return (
    <div>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
        <input
          type="checkbox"
          data-track="settings-secondary-timezone-toggle"
          checked={timezone !== null}
          disabled={saving}
          onChange={(e) => save(e.target.checked ? ORG_TIMEZONE : null)}
          className="h-4 w-4 rounded border-slate-300 text-plum-600 focus:ring-plum-500"
        />
        Show a secondary time zone
      </label>
      {timezone !== null && (
        <div className="mt-2">
          <label htmlFor="secondary-timezone" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            Secondary time zone
          </label>
          <select
            id="secondary-timezone"
            data-track="settings-secondary-timezone"
            value={timezone}
            onChange={(e) => save(e.target.value)}
            disabled={saving}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-plum-500 focus:border-transparent disabled:opacity-50"
          >
            {options.map((tz) =>
              "disabled" in tz && tz.disabled ? (
                <option key={tz.value} disabled>
                  {tz.label}
                </option>
              ) : (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              )
            )}
          </select>
        </div>
      )}
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Shown in parentheses beside your primary time zone. Prickles are announced in Eastern time, so many members pick it: 4:00 AM (7:00 AM ET).
        {saving && <span className="ml-2 italic">Saving...</span>}
      </p>
    </div>
  );
}
