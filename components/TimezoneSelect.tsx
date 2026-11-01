"use client";

const PRESET_TIMEZONES = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "UTC", label: "UTC" },
];

/** Options for the select: the presets, plus `value` when it isn't one of them. */
export function timezoneOptions(value: string) {
  if (PRESET_TIMEZONES.some((tz) => tz.value === value)) return PRESET_TIMEZONES;
  // "America/Costa_Rica" -> "Costa Rica"
  return [{ value, label: value.split("/").pop()!.replace(/_/g, " ") }, ...PRESET_TIMEZONES];
}

interface TimezoneSelectProps {
  value: string;
  onChange: (timezone: string) => void;
  /** The `data-track` name for the control. */
  track: string;
}

/**
 * The "Timezone:" picker on prickle and attendance views. A member's own zone is rarely a preset, and
 * a select with no option for its value shows its first entry (Eastern) while the times are in the
 * member's zone, so the current zone is always listed and selected.
 */
export default function TimezoneSelect({ value, onChange, track }: TimezoneSelectProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Timezone:</span>
      <select
        data-track={track}
        aria-label="Timezone"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-plum-500"
      >
        {timezoneOptions(value).map((tz) => (
          <option key={tz.value} value={tz.value}>
            {tz.label}
          </option>
        ))}
      </select>
    </div>
  );
}
