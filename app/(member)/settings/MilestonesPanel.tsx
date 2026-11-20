"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  MAX_STORY_LENGTH,
  MILESTONE_CLAIMS,
  MILESTONE_CONSENTS,
  MILESTONE_LABELS,
  MILESTONE_SOURCE_NOTES,
  type ConsentKey,
  type Consents,
} from "@/lib/finishers";
import type { Milestone } from "@/lib/data/milestones";
import { answerMilestone } from "./milestoneActions";

const INPUT = "w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm";
const PRIMARY = "px-4 py-2 bg-plum-600 text-white text-sm rounded-md hover:bg-plum-700 disabled:opacity-50 disabled:cursor-not-allowed";
const SECONDARY = "px-4 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50";

const consentsOf = (m: Milestone): Consents => ({
  consent_profile: m.consentProfile,
  consent_homepage: m.consentHomepage,
  consent_testimonial: m.consentTestimonial,
});

function MilestoneForm({ milestone, onDone, readOnly }: { milestone: Milestone; onDone: () => void; readOnly: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(milestone.achievedOn ?? "");
  const [before, setBefore] = useState(milestone.storyBefore ?? "");
  const [after, setAfter] = useState(milestone.storyAfter ?? "");
  // Every use starts unticked; a milestone already confirmed shows what the member chose.
  const [consents, setConsents] = useState<Consents>(milestone.status === "confirmed" ? consentsOf(milestone) : { consent_profile: false, consent_homepage: false, consent_testimonial: false });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await answerMilestone({ id: milestone.id, answer: "confirm", achievedOn: date || null, storyBefore: before, storyAfter: after, consents });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
      onDone();
    });
  };

  return (
    <form onSubmit={submit} className="mt-3 space-y-4">
      <div>
        <label htmlFor={`ms-date-${milestone.id}`} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          When did it happen? (optional)
        </label>
        <input id={`ms-date-${milestone.id}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${INPUT} sm:w-56`} />
      </div>
      <div>
        <label htmlFor={`ms-before-${milestone.id}`} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          How did it feel before you got here? (optional)
        </label>
        <textarea id={`ms-before-${milestone.id}`} rows={3} maxLength={MAX_STORY_LENGTH} value={before} onChange={(e) => setBefore(e.target.value)} className={INPUT} />
      </div>
      <div>
        <label htmlFor={`ms-after-${milestone.id}`} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          And how does it feel now? (optional)
        </label>
        <textarea id={`ms-after-${milestone.id}`} rows={3} maxLength={MAX_STORY_LENGTH} value={after} onChange={(e) => setAfter(e.target.value)} className={INPUT} />
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-slate-700 dark:text-slate-300">Where may we show this?</legend>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          Nothing is shown anywhere yet. Your answer is saved, and it will only be used where you tick a box. You can change your mind here at any time.
        </p>
        <div className="mt-2 space-y-2">
          {MILESTONE_CONSENTS.map(({ key, label, hint }) => (
            <label key={key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={consents[key as ConsentKey]}
                onChange={(e) => setConsents((c) => ({ ...c, [key]: e.target.checked }))}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{label}</span>
                <span className="block text-xs text-slate-600 dark:text-slate-400">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button type="submit" disabled={pending || readOnly} className={PRIMARY}>
          {pending ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={onDone} disabled={pending} className={SECONDARY}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function MilestoneItem({ milestone, readOnly }: { milestone: Milestone; readOnly: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const decline = () =>
    startTransition(async () => {
      setError(null);
      const result = await answerMilestone({ id: milestone.id, answer: "decline" });
      if ("error" in result) setError(result.error);
      else router.refresh();
    });

  const chosen = MILESTONE_CONSENTS.filter(({ key }) => consentsOf(milestone)[key]).map(({ label }) => label);

  return (
    <li className="rounded-md border border-slate-200 dark:border-slate-700 p-4">
      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
        {MILESTONE_CLAIMS[milestone.kind]} <span className="text-slate-500 dark:text-slate-400">({MILESTONE_LABELS[milestone.kind]})</span>
      </p>
      {milestone.status === "proposed" && !editing && (
        <>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{MILESTONE_SOURCE_NOTES[milestone.source]} Is this you?</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" onClick={() => setEditing(true)} disabled={readOnly} className={PRIMARY} data-track="milestone-confirm-open">
              Yes, this is me
            </button>
            <button type="button" onClick={decline} disabled={pending || readOnly} className={SECONDARY} data-track="milestone-decline">
              Not me / not yet
            </button>
          </div>
        </>
      )}
      {milestone.status === "confirmed" && !editing && (
        <>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Saved. {chosen.length > 0 ? `You said we may show it on: ${chosen.join(", ")}.` : "You haven't chosen anywhere to show it, so it stays private."}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" onClick={() => setEditing(true)} disabled={readOnly} className={SECONDARY}>
              Change
            </button>
            <button type="button" onClick={decline} disabled={pending || readOnly} className={SECONDARY}>
              Not me / not yet
            </button>
          </div>
        </>
      )}
      {milestone.status === "declined" && !editing && (
        <>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">You said this isn&rsquo;t you, or not yet. We won&rsquo;t show it anywhere.</p>
          <div className="mt-3">
            <button type="button" onClick={() => setEditing(true)} disabled={readOnly} className={SECONDARY}>
              Actually, it is me
            </button>
          </div>
        </>
      )}
      {editing && <MilestoneForm milestone={milestone} onDone={() => setEditing(false)} readOnly={readOnly} />}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * Settings > Profile: "Your milestones". Milestones staff or a course proposed wait for the member's answer; the ones
 * they answered stay here so they can change it. Nothing here is public: a milestone is only used where its box is ticked.
 */
export function MilestonesPanel({ milestones, readOnly = false }: { milestones: Milestone[]; readOnly?: boolean }) {
  if (milestones.length === 0) return null;
  return (
    <section aria-labelledby="your-milestones" className="border-t border-slate-200 dark:border-slate-700 pt-6 mt-6">
      <h2 id="your-milestones" className="text-lg font-medium text-slate-900 dark:text-slate-100">
        Your milestones
      </h2>
      <p className="mt-1 mb-4 text-sm text-slate-600 dark:text-slate-400">
        We think you may have reached {milestones.length === 1 ? "a writing milestone" : "some writing milestones"}. Tell us if that&rsquo;s right. Only you can say
        so, and nothing is shown to anyone until you choose where.
        {readOnly && " (You are viewing as this member, so you can look but not answer.)"}
      </p>
      <ul className="space-y-3">
        {milestones.map((m) => (
          <MilestoneItem key={m.id} milestone={m} readOnly={readOnly} />
        ))}
      </ul>
    </section>
  );
}
