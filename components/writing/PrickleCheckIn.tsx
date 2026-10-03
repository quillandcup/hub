"use client";

import { useState } from "react";
import { saveCheckin } from "@/app/(member)/prickles/checkin-actions";
import { isEmptyCheckin, type CheckinInput } from "@/lib/prickle-checkins";
import { FeelingPicker, NeedPicker, RatingPicker } from "@/components/writing/CheckinFields";

interface PrickleCheckInProps {
  prickleId: string;
  /**
   * Past the first CHECKIN_AFTER_MINUTES of the prickle (see asksHowItWent): also ask how it went
   * and how they feel now. Before that, only the "coming in" questions.
   */
  askHowItWent: boolean;
  initial: CheckinInput | null;
  /** Sudo: an admin sees the member's answers but can't change them. */
  readOnly?: boolean;
  /**
   * Unsaved starting answers (e.g. from the Prickle Picker) when there's no saved check-in yet.
   * Shown selected with Save enabled; nothing is stored until the member saves.
   */
  prefill?: CheckinInput | null;
}

const EMPTY: CheckinInput = { feelingsBefore: [], need: null, sessionRating: null, feelingsAfter: [] };

/** Private check-in for a prickle: feelings coming in, what the member needs, and how it went. */
export default function PrickleCheckIn({
  prickleId,
  askHowItWent,
  initial,
  readOnly = false,
  prefill = null,
}: PrickleCheckInProps) {
  const [checkin, setCheckin] = useState<CheckinInput>(initial ?? (readOnly ? null : prefill) ?? EMPTY);
  const [saved, setSaved] = useState<CheckinInput>(initial ?? EMPTY);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const isDirty = JSON.stringify(checkin) !== JSON.stringify(saved);

  function update(patch: Partial<CheckinInput>) {
    setCheckin((c) => ({ ...c, ...patch }));
    setJustSaved(false);
  }

  async function handleSave() {
    setError(null);
    setIsPending(true);
    const result = await saveCheckin(prickleId, checkin);
    setIsPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSaved(checkin);
    setJustSaved(true);
  }

  return (
    <section
      aria-labelledby="prickle-checkin-heading"
      className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 space-y-5"
    >
      <div>
        <h2 id="prickle-checkin-heading" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Check in
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {readOnly
            ? "Read-only while browsing as this member."
            : "Optional. Over time it shows which prickles help most when you're feeling a certain way."}
        </p>
      </div>

      <FeelingPicker
        label="Coming in, I'm feeling…"
        selected={checkin.feelingsBefore}
        onChange={(feelingsBefore) => update({ feelingsBefore })}
        readOnly={readOnly}
      />

      <NeedPicker
        label="What I need from this session"
        value={checkin.need}
        onChange={(need) => update({ need })}
        readOnly={readOnly}
      />

      {askHowItWent && (
        <>
          <RatingPicker
            label="How did it go?"
            value={checkin.sessionRating}
            onChange={(sessionRating) => update({ sessionRating })}
            readOnly={readOnly}
          />

          <FeelingPicker
            label="Feeling now…"
            selected={checkin.feelingsAfter}
            onChange={(feelingsAfter) => update({ feelingsAfter })}
            readOnly={readOnly}
          />
        </>
      )}

      {!readOnly && (
        <div className="flex items-center justify-end gap-3">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {justSaved && !isDirty && <p className="text-sm text-slate-500 dark:text-slate-400">Saved</p>}
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending || !isDirty}
            className="px-4 py-2 text-sm bg-plum-600 text-white rounded-lg hover:bg-plum-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? "Saving..." : isEmptyCheckin(checkin) && !isEmptyCheckin(saved) ? "Clear check-in" : "Save check-in"}
          </button>
        </div>
      )}
    </section>
  );
}
