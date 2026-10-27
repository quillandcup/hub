"use client";

import {
  REGISTRATION_LABELS,
  REGISTRATION_MODES,
  SELECTION_LABELS,
  SELECTION_MODES,
  type EventAudience,
} from "@/lib/event-audience";
import { withAudienceChange } from "@/lib/audience-rules";

const INPUT = "w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded";
const LABEL = "block text-sm font-medium mb-1 dark:text-gray-200";

/**
 * The fields that say who an event is for and how people join it, shared by the admin create and
 * edit forms. Capacity and how places are given out only appear once people have to register.
 */
export default function EventAudienceFields({
  value,
  onChange,
}: {
  value: EventAudience;
  onChange: (next: EventAudience) => void;
}) {
  const set = (patch: Partial<EventAudience>) => onChange({ ...value, ...patch });
  const registers = value.registration !== "none";
  // An event is listed by being an event, so only "announced publicly" can switch guests off.
  const withEventAudienceChange = (flags: EventAudience, change: Partial<EventAudience>): Partial<EventAudience> => {
    const next = withAudienceChange(
      { listed: true, publicly: flags.announced_publicly, guests: flags.guests_allowed },
      { publicly: change.announced_publicly ?? flags.announced_publicly },
    );
    return { announced_publicly: next.publicly, guests_allowed: next.guests };
  };

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium dark:text-gray-200">Who it&apos;s for</legend>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-sm dark:text-gray-200">
          <input
            type="checkbox"
            checked={value.announced_publicly}
            onChange={(e) => set(withEventAudienceChange(value, { announced_publicly: e.target.checked }))}
            className="rounded border-gray-300 dark:border-slate-600"
          />
          Announced publicly
        </label>
        <label className={`flex items-center gap-2 text-sm dark:text-gray-200 ${value.announced_publicly ? "" : "opacity-50"}`}>
          <input
            type="checkbox"
            checked={value.guests_allowed}
            disabled={!value.announced_publicly}
            onChange={(e) => set({ guests_allowed: e.target.checked })}
            className="rounded border-gray-300 dark:border-slate-600"
          />
          Guests allowed
        </label>
      </div>
      <div className="@container">
        <div className="grid grid-cols-1 @pair:grid-cols-2 gap-3">
          <div>
            <label className={LABEL} htmlFor="event-registration">How people join</label>
            <select
              id="event-registration"
              value={value.registration}
              onChange={(e) => set({ registration: e.target.value as EventAudience["registration"] })}
              className={INPUT}
            >
              {REGISTRATION_MODES.map((m) => (
                <option key={m} value={m}>{REGISTRATION_LABELS[m]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL} htmlFor="event-capacity">Places (empty for no limit)</label>
            <input
              id="event-capacity"
              type="number"
              min={1}
              step={1}
              value={value.capacity ?? ""}
              onChange={(e) => set({ capacity: e.target.value === "" ? null : Number(e.target.value) })}
              className={INPUT}
            />
          </div>
          {registers && value.capacity !== null && (
            <div>
              <label className={LABEL} htmlFor="event-selection">When there are more people than places</label>
              <select
                id="event-selection"
                value={value.selection}
                onChange={(e) => set({ selection: e.target.value as EventAudience["selection"] })}
                className={INPUT}
              >
                {SELECTION_MODES.map((m) => (
                  <option key={m} value={m}>{SELECTION_LABELS[m]}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>
      <div>
        <label className={LABEL} htmlFor="event-speakers">Guest speakers</label>
        <input
          id="event-speakers"
          type="text"
          value={value.speakers ?? ""}
          onChange={(e) => set({ speakers: e.target.value || null })}
          className={INPUT}
        />
      </div>
    </fieldset>
  );
}
