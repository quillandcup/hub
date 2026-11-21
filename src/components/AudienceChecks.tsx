"use client";

import { withAudienceChange, type AudienceChain } from "@/lib/audience-rules";

const CHECK = "rounded border-slate-300 dark:border-slate-600";
const LABEL = "flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300";
const HINT = "mt-1 text-xs text-slate-600 dark:text-slate-400";

/**
 * A prickle type's three audience checkboxes, in the order they depend on each other: listed in Events,
 * then announced publicly, then guests allowed. Each is greyed out until the one before it is checked,
 * and unchecking one unchecks what came after it.
 */
export default function AudienceChecks({ value, onChange }: { value: AudienceChain; onChange: (next: AudienceChain) => void }) {
  const set = (change: Partial<AudienceChain>) => onChange(withAudienceChange(value, change));

  return (
    <>
      <div className="mb-6">
        <label className={LABEL}>
          <input type="checkbox" checked={value.listed} onChange={(e) => set({ listed: e.target.checked })} className={CHECK} />
          Listed in Events
        </label>
        <p className={HINT}>
          Show upcoming prickles of this type on the member Events page (webinars, Hedgies on First, Monthly Goal Review, pitches).
          Leave off for everyday progress and sprint prickles.
        </p>
      </div>

      <div className="mb-6">
        <label className={`${LABEL} ${value.listed ? "" : "opacity-50"}`}>
          <input
            type="checkbox"
            checked={value.publicly}
            disabled={!value.listed}
            onChange={(e) => set({ publicly: e.target.checked })}
            className={CHECK}
          />
          Announced publicly
        </label>
        <p className={HINT}>Include in public marketing. Needs Listed in Events. Not used by any page yet.</p>
      </div>

      <div className="mb-6">
        <label className={`${LABEL} ${value.publicly ? "" : "opacity-50"}`}>
          <input
            type="checkbox"
            checked={value.guests}
            disabled={!value.publicly}
            onChange={(e) => set({ guests: e.target.checked })}
            className={CHECK}
          />
          Guests allowed
        </label>
        <p className={HINT}>Non-members may attend. Needs Announced publicly. Not used by any page yet.</p>
      </div>
    </>
  );
}
