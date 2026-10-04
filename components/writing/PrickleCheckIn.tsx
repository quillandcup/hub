"use client";

import { useState } from "react";
import { saveCheckin } from "@/app/(member)/prickles/checkin-actions";
import { isEmptyCheckin, type CheckinInput } from "@/lib/prickle-checkins";
import { FeelingPicker, NeedPicker, RatingPicker } from "@/components/writing/CheckinFields";

interface PrickleCheckInProps {
  prickleId: string;
  /** The prickle has started, so the check-out can be answered. */
  hasStarted: boolean;
  initial: CheckinInput | null;
  /** Sudo: an admin sees the member's answers but can't change them. */
  readOnly?: boolean;
  /**
   * Unsaved starting answers (e.g. from Find a Prickle) when there's no saved check-in yet.
   * Shown selected with Save enabled; nothing is stored until the member saves.
   */
  prefill?: CheckinInput | null;
}

const EMPTY: CheckinInput = { feelingsBefore: [], need: null, sessionRating: null, feelingsAfter: [] };

/**
 * The home for a member's check-in (feelings coming in, what they need) and check-out (how it
 * went, feeling now) for a prickle, editable any time: the check-in always, the check-out once
 * the prickle starts. Both halves are one prickle_checkins row, also answered from the Slack
 * check-in/check-out DMs, and the check-out from the Log Progress modal.
 */
export default function PrickleCheckIn({
  prickleId,
  hasStarted,
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
          Check in &amp; out
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {readOnly
            ? "Read-only while browsing as this member."
            : "Optional. Over time it shows which prickles help most when you're feeling a certain way."}
        </p>
      </div>

      <div role="group" aria-labelledby="prickle-checkin-in" className="space-y-4">
        <h3 id="prickle-checkin-in" className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Check in
        </h3>
        <FeelingPicker
          label={hasStarted ? "Coming in, I was feeling…" : "Coming in, I'm feeling…"}
          selected={checkin.feelingsBefore}
          onChange={(feelingsBefore) => update({ feelingsBefore })}
          readOnly={readOnly}
        />
        <NeedPicker
          label={hasStarted ? "What I needed from this session" : "What I need from this session"}
          value={checkin.need}
          onChange={(need) => update({ need })}
          readOnly={readOnly}
        />
      </div>

      <div
        role="group"
        aria-labelledby="prickle-checkin-out"
        className="space-y-4 border-t border-slate-200 dark:border-slate-800 pt-5"
      >
        <h3 id="prickle-checkin-out" className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Check out
        </h3>
        {hasStarted ? (
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
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">Available once the prickle starts.</p>
        )}
      </div>

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
            {isPending ? "Saving..." : isEmptyCheckin(checkin) && !isEmptyCheckin(saved) ? "Clear answers" : "Save"}
          </button>
        </div>
      )}
    </section>
  );
}
