"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import DatePicker from "@/components/DatePicker";
import EntitySearch, { type SearchItem } from "@/components/EntitySearch";
import Modal from "@/components/Modal";
import { track } from "@/lib/analytics/client";
import { CARE_NOTES_MAX, CARE_REASONS, CARE_REASON_HELP, CARE_REASON_LABELS, isCareReason } from "@/lib/care";
import { searchCareMembers, startEngagement } from "./actions";

const FIELD = "w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-sm";
const LABEL = "block text-sm font-medium mb-1";

const BUTTON_LOOK = {
  primary: "rounded-lg bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700",
  row: "rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800",
};

/**
 * "Start a care plan" button, at the top of the Active tab or on a row of the DMs tab. The form opens in a dialog, so it does
 * not push the care plans down; closing it (Escape, the close button, a click outside) drops what was typed, and starting one
 * closes it. With `member` the form is for that member (the DMs tab: the row says who), else she searches for one. A care plan
 * belongs to the member, not to a channel, so the form never asks where.
 */
export default function StartEngagementForm({
  today,
  member,
  label = "Start a care plan",
  look = "primary",
}: {
  today: string;
  member?: SearchItem;
  label?: string;
  look?: keyof typeof BUTTON_LOOK;
}) {
  const [open, setOpen] = useState(false);
  // A start in flight can't be walked away from: she would not see whether it worked.
  const busy = useRef(false);
  const setBusy = useCallback((b: boolean) => {
    busy.current = b;
  }, []);
  return (
    <div className={look === "primary" ? "flex justify-end" : undefined}>
      <button type="button" data-track="care-start-open" onClick={() => setOpen(true)} className={BUTTON_LOOK[look]}>
        {label}
      </button>
      <Modal isOpen={open} onClose={() => !busy.current && setOpen(false)} title="Start a care plan" maxWidth="2xl">
        <StartForm today={today} fixedMember={member} onBusy={setBusy} onStarted={() => setOpen(false)} />
      </Modal>
    </div>
  );
}

/**
 * The form: who, why, the day it started, an optional note and follow-up. Who spoke first is not asked: her Slack DM with
 * them (starting tracks it) or the "They replied" / "I replied" buttons on the care plan say so.
 */
function StartForm({
  today,
  fixedMember,
  onBusy,
  onStarted,
}: {
  today: string;
  fixedMember?: SearchItem;
  onBusy: (busy: boolean) => void;
  onStarted: () => void;
}) {
  const [chosen, setMember] = useState<SearchItem | null>(null);
  const member = fixedMember ?? chosen;
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [followUpOn, setFollowUpOn] = useState("");
  const [startedOn, setStartedOn] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    onBusy(pending);
  }, [pending, onBusy]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!member) return setError("Pick a member.");
    if (!isCareReason(reason)) return setError("Pick why you are reaching out.");
    if (!startedOn) return setError("Pick the day it started.");
    setError(null);
    startTransition(async () => {
      const result = await startEngagement({ memberId: member.id, startedOn, reason, notes, followUpOn });
      if ("error" in result) return setError(result.error);
      track("care_engagement_started", { reason, backdated: startedOn < today });
      onStarted();
    });
  }

  return (
    <form onSubmit={submit} className="@container">
      <div className="grid grid-cols-1 gap-4 @pair:grid-cols-2">
        <div className="@pair:col-span-2">
          <span className={LABEL} id="care-member-label">
            Member
          </span>
          {fixedMember ? (
            <p className="text-sm font-medium" aria-labelledby="care-member-label">
              {fixedMember.name}
              {fixedMember.detail && <span className="ml-2 text-xs font-normal text-slate-600 dark:text-slate-400">{fixedMember.detail}</span>}
            </p>
          ) : (
            <EntitySearch
              search={searchCareMembers}
              selectedId={member?.id ?? null}
              selectedName={member?.name ?? null}
              selectedDetail={member?.detail ?? null}
              onSelect={setMember}
              placeholder="Search for a member"
              ariaLabel="Member"
              emptyText="No one found."
            />
          )}
        </div>
        <fieldset className="@pair:col-span-2">
          <legend className={LABEL}>Why you are reaching out</legend>
          <div className="space-y-2">
            {CARE_REASONS.map((r) => (
              <label key={r} className="flex items-start gap-2 text-sm">
                <input type="radio" name="care-reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="mt-1" />
                <span>
                  <span className="font-medium">{CARE_REASON_LABELS[r]}</span>
                  <span className="block text-slate-600 dark:text-slate-400">{CARE_REASON_HELP[r]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <DatePicker id="care-started-on" label="When did this start?" value={startedOn} onChange={setStartedOn} max={today} />
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Today, or the day you first wrote if you are catching up. The care plan runs from this day.</p>
        </div>
        <DatePicker id="care-follow-up" label="Follow up on" value={followUpOn} onChange={setFollowUpOn} />
        <div className="@pair:col-span-2">
          <label htmlFor="care-notes" className={LABEL}>
            Note
          </label>
          <textarea
            id="care-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={CARE_NOTES_MAX}
            rows={2}
            placeholder="What you said or why. Keep it light: nothing sensitive."
            className={FIELD}
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        data-track="care-start"
        disabled={pending}
        className="mt-4 rounded-lg bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50"
      >
        {pending ? "Starting…" : "Start plan"}
      </button>
    </form>
  );
}
