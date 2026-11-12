"use client";

import { useState, useTransition } from "react";
import DatePicker from "@/components/DatePicker";
import EntitySearch, { type SearchItem } from "@/components/EntitySearch";
import { track } from "@/lib/analytics/client";
import {
  CARE_CHANNELS,
  CARE_CHANNEL_LABELS,
  CARE_NOTES_MAX,
  CARE_REASONS,
  CARE_REASON_HELP,
  CARE_REASON_LABELS,
  isCareChannel,
  isCareReason,
} from "@/lib/care";
import { searchCareMembers, startEngagement } from "./actions";

const FIELD = "w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-sm";
const LABEL = "block text-sm font-medium mb-1";

/**
 * Starts a care period: who, why, where, the day it started and an optional note. She reached out, or they wrote to her first.
 *
 * `slackDmMemberIds` are the members whose Slack DM she tracks and whose new Slack DM care period would follow it (she is
 * the owner it would get). For one of them on the Slack DM channel the DM says who wrote first, so the "They wrote to me
 * first" tick is replaced by a line saying so. A member she has a DM with but has not tracked yet (starting tracks it) can't
 * be told apart from one with no DM without a Slack lookup, so for them the tick stays: it is a placeholder the DM replaces.
 */
export default function StartEngagementForm({ today, slackDmMemberIds = [] }: { today: string; slackDmMemberIds?: readonly string[] }) {
  const [member, setMember] = useState<SearchItem | null>(null);
  const [reason, setReason] = useState("");
  const [channel, setChannel] = useState("slack_dm");
  const [memberWroteFirst, setMemberWroteFirst] = useState(false);
  const [notes, setNotes] = useState("");
  const [followUpOn, setFollowUpOn] = useState("");
  const [startedOn, setStartedOn] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dmTellsWhoWroteFirst = channel === "slack_dm" && !!member && slackDmMemberIds.includes(member.id);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!member) return setError("Pick a member.");
    if (!isCareReason(reason) || !isCareChannel(channel)) return setError("Pick why you are reaching out.");
    if (!startedOn) return setError("Pick the day it started.");
    setError(null);
    // A tick left on from another channel or member does not count once the DM is what says who wrote first.
    const wroteFirst = memberWroteFirst && !dmTellsWhoWroteFirst;
    startTransition(async () => {
      const result = await startEngagement({ memberId: member.id, startedOn, reason, channel, memberWroteFirst: wroteFirst, notes, followUpOn });
      if ("error" in result) return setError(result.error);
      track("care_engagement_started", { reason, channel, member_wrote_first: wroteFirst, backdated: startedOn < today });
      setMember(null);
      setReason("");
      setMemberWroteFirst(false);
      setNotes("");
      setFollowUpOn("");
      setStartedOn(today);
    });
  }

  return (
    <form onSubmit={submit} className="@container rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-lg font-semibold">Start a care period</h2>
      <div className="mt-3 grid grid-cols-1 gap-4 @pair:grid-cols-2">
        <div>
          <span className={LABEL} id="care-member-label">
            Member
          </span>
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
          <label htmlFor="care-channel" className={LABEL}>
            Where
          </label>
          <select id="care-channel" value={channel} onChange={(e) => setChannel(e.target.value)} className={FIELD}>
            {CARE_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CARE_CHANNEL_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <DatePicker id="care-started-on" label="When did this start?" value={startedOn} onChange={setStartedOn} max={today} />
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Today, or the day you first wrote if you are catching up. The care period runs from this day.</p>
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
      {dmTellsWhoWroteFirst ? (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">Your Slack DM with them tells who wrote first.</p>
      ) : (
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={memberWroteFirst} onChange={(e) => setMemberWroteFirst(e.target.checked)} />
          They wrote to me first
        </label>
      )}
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
        {pending ? "Starting…" : "Start tracking"}
      </button>
    </form>
  );
}
