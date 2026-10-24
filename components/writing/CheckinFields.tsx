"use client";

import { Fragment, useId } from "react";
import EntitySearch from "@/components/EntitySearch";
import {
  EMOTION_PATH,
  EMOTION_QUESTION,
  EMOTION_WHEEL,
  EMOTION_WHEEL_CREDIT,
  ENERGY,
  ENERGY_QUESTION,
  INTENTION_MET,
  INTENTION_MET_QUESTION,
  NEEDS,
  PLEASANTNESS,
  PLEASANTNESS_QUESTION,
  emotionLabel,
  corePairs,
  emotionParentsLabel,
  searchEmotions,
  type CheckinInput,
  type Emotion,
  type Need,
  type ScalePoint,
} from "@/lib/prickle-checkins";

// Check-in inputs shared by the check-in/check-out modal, the Log Progress modal and Find a Prickle.

export function chipClass(selected: boolean, disabled = false): string {
  const base = "px-3 py-1 rounded-full text-sm border transition-colors";
  if (selected) return `${base} bg-plum-600 border-plum-600 text-white`;
  if (disabled) return `${base} border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed`;
  return `${base} border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-plum-400`;
}

const legendClass = "text-sm font-medium text-slate-700 dark:text-slate-300 mb-2";

/** A labeled 1-5 scale as a row of buttons; picking the selected point again clears it. */
export function ScalePicker({
  label,
  points,
  value,
  onChange,
  readOnly = false,
}: {
  label: string;
  points: readonly ScalePoint[];
  value: number | null;
  onChange: (next: number | null) => void;
  readOnly?: boolean;
}) {
  return (
    <fieldset>
      <legend className={legendClass}>{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {points.map((p) => {
          const isSelected = value === p.value;
          return (
            <button
              data-track="checkin-scale"
              key={p.value}
              type="button"
              aria-pressed={isSelected}
              disabled={readOnly}
              onClick={() => onChange(isSelected ? null : p.value)}
              className={chipClass(isSelected)}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Mood as the two circumplex axes, pleasantness and energy. */
export function MoodPicker({
  label,
  pleasant,
  energy,
  onChange,
  readOnly = false,
}: {
  label: string;
  pleasant: number | null;
  energy: number | null;
  onChange: (next: { pleasant: number | null; energy: number | null }) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{label}</p>
      <ScalePicker
        label={PLEASANTNESS_QUESTION}
        points={PLEASANTNESS}
        value={pleasant}
        onChange={(next) => onChange({ pleasant: next, energy })}
        readOnly={readOnly}
      />
      <ScalePicker
        label={ENERGY_QUESTION}
        points={ENERGY}
        value={energy}
        onChange={(next) => onChange({ pleasant, energy: next })}
        readOnly={readOnly}
      />
    </div>
  );
}

/** Search results for the feeling search: wheel words first, then suggestions, each saying why it's there. */
function matchEmotions(term: string) {
  return searchEmotions(term).map(({ emotion, suggestedFor }) => {
    const core = emotionParentsLabel(emotion);
    const detail = suggestedFor ? [`for “${suggestedFor}”`, core].filter(Boolean).join(" · ") : core || null;
    return { id: emotion, name: emotionLabel(emotion), detail };
  });
}

/** A row of chips to pick one from (the core feelings). */
function EmotionRing({
  label,
  options,
  value,
  onPick,
  readOnly,
  track,
}: {
  label: string;
  options: readonly Emotion[];
  value: Emotion | undefined;
  onPick: (picked: Emotion) => void;
  readOnly: boolean;
  track: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((e) => {
        const isSelected = value === e;
        return (
          <button
            data-track={track}
            key={e}
            type="button"
            aria-pressed={isSelected}
            disabled={readOnly}
            onClick={() => onPick(e)}
            className={chipClass(isSelected)}
          >
            {emotionLabel(e)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The Feeling Wheel as a drill-down: pick a core feeling, then optionally one of its feelings,
 * shown as the wheel pairs them, each middle-ring word with the outer-ring word beside it (Rage ·
 * Furious). Or search for any word on the wheel and land on it directly; the rings then show
 * where it sits. Picking the chosen word again steps back out (a core clears the answer).
 */
export function EmotionPicker({
  value,
  onChange,
  readOnly = false,
}: {
  value: Emotion | null;
  onChange: (next: Emotion | null) => void;
  readOnly?: boolean;
}) {
  const [core, feeling] = value ? EMOTION_PATH[value] : [];
  const coreEntry = EMOTION_WHEEL.find((c) => c.key === core);
  const pickFeeling = (e: Emotion) => onChange(value === e ? core ?? null : e);
  return (
    <fieldset>
      <legend className={legendClass}>
        {EMOTION_QUESTION} <span className="text-slate-400 font-normal">(optional)</span>
      </legend>
      {!readOnly && (
        <EntitySearch
          match={matchEmotions}
          selectedId={null}
          onSelect={(item) => item && onChange(item.id as Emotion)}
          placeholder="Search for a feeling, e.g. frustrated"
          className="mb-3"
        />
      )}
      <EmotionRing
        label="Core feeling"
        options={EMOTION_WHEEL.map((c) => c.key)}
        value={core}
        onPick={(e) => onChange(value === e ? null : e)}
        readOnly={readOnly}
        track="checkin-emotion-core"
      />
      {coreEntry && (
        <div
          role="group"
          aria-label={`More specifically, ${coreEntry.label.toLowerCase()}`}
          className="mt-2 pl-3 border-l-2 border-plum-200 dark:border-plum-800 flex flex-wrap gap-2"
        >
          {/* Each pair stays together and the pairs wrap to the room there is: no breakpoints. */}
          {corePairs(coreEntry).map(([middle, outer]) => (
            <div
              key={middle}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-200 dark:border-slate-700 p-0.5"
            >
              {[middle, outer].map((e, i) => (
                <Fragment key={e}>
                  {i === 1 && (
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                      ·
                    </span>
                  )}
                  <button
                    data-track={i === 0 ? "checkin-emotion" : "checkin-emotion-outer"}
                    type="button"
                    aria-pressed={feeling === e}
                    disabled={readOnly}
                    onClick={() => pickFeeling(e)}
                    className={chipClass(feeling === e)}
                  >
                    {emotionLabel(e)}
                  </button>
                </Fragment>
              ))}
            </div>
          ))}
        </div>
      )}
      <p className="mt-1.5 text-xs text-slate-400">{EMOTION_WHEEL_CREDIT}</p>
    </fieldset>
  );
}

/** "Choose your intention": what the member needs most from the session, as a drop-down. */
export function NeedPicker({
  label,
  value,
  onChange,
  readOnly = false,
}: {
  label: string;
  value: Need | null;
  onChange: (next: Need | null) => void;
  readOnly?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={`block ${legendClass}`}>
        {label}
      </label>
      <select
        id={id}
        data-track="checkin-need"
        value={value ?? ""}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value === "" ? null : (e.target.value as Need))}
        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
      >
        <option value="">Choose your intention…</option>
        {NEEDS.map((n) => (
          <option key={n.key} value={n.key}>
            {n.label} · {n.hint}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Every question of one half, in order. Check-in: mood, the feeling, the intention. Check-out:
 * got what they came for, mood, the feeling. `past` words the check-in for a prickle that has
 * already started.
 */
export function CheckinHalfFields({
  half,
  value,
  onChange,
  readOnly = false,
  past = false,
}: {
  half: "checkin" | "checkout";
  value: CheckinInput;
  onChange: (patch: Partial<CheckinInput>) => void;
  readOnly?: boolean;
  past?: boolean;
}) {
  if (half === "checkin") {
    return (
      <>
        <MoodPicker
          label={past ? "Coming in, how were you feeling?" : "How are you feeling right now?"}
          pleasant={value.pleasantBefore}
          energy={value.energyBefore}
          onChange={({ pleasant, energy }) => onChange({ pleasantBefore: pleasant, energyBefore: energy })}
          readOnly={readOnly}
        />
        <EmotionPicker value={value.emotionBefore} onChange={(emotionBefore) => onChange({ emotionBefore })} readOnly={readOnly} />
        <NeedPicker
          label={past ? "My intention for the session was…" : "My intention for this session"}
          value={value.need}
          onChange={(need) => onChange({ need })}
          readOnly={readOnly}
        />
      </>
    );
  }
  return (
    <>
      <ScalePicker
        label={INTENTION_MET_QUESTION}
        points={INTENTION_MET}
        value={value.intentionMet}
        onChange={(intentionMet) => onChange({ intentionMet })}
        readOnly={readOnly}
      />
      <MoodPicker
        label="How are you feeling now?"
        pleasant={value.pleasantAfter}
        energy={value.energyAfter}
        onChange={({ pleasant, energy }) => onChange({ pleasantAfter: pleasant, energyAfter: energy })}
        readOnly={readOnly}
      />
      <EmotionPicker value={value.emotionAfter} onChange={(emotionAfter) => onChange({ emotionAfter })} readOnly={readOnly} />
    </>
  );
}
