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
  CARE_REASON_LABELS,
  isCareChannel,
  isCareReason,
} from "@/lib/care";
import { searchCareMembers, startEngagement } from "./actions";

const FIELD = "w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-sm";
const LABEL = "block text-sm font-medium mb-1";

/** Starts an engagement: who, why, where, and an optional note. She reached out, or they wrote to her first. */
export default function StartEngagementForm() {
  const [member, setMember] = useState<SearchItem | null>(null);
  const [reason, setReason] = useState("");
  const [channel, setChannel] = useState("slack_dm");
  const [memberWroteFirst, setMemberWroteFirst] = useState(false);
  const [notes, setNotes] = useState("");
  const [followUpOn, setFollowUpOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!member) return setError("Pick a member.");
    if (!isCareReason(reason) || !isCareChannel(channel)) return setError("Pick why you are reaching out.");
    setError(null);
    startTransition(async () => {
      const result = await startEngagement({ memberId: member.id, reason, channel, memberWroteFirst, notes, followUpOn });
      if ("error" in result) return setError(result.error);
      track("care_engagement_started", { reason, channel, member_wrote_first: memberWroteFirst });
      setMember(null);
      setReason("");
      setMemberWroteFirst(false);
      setNotes("");
      setFollowUpOn("");
    });
  }

  return (
    <form onSubmit={submit} className="@container rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-lg font-semibold">Start an engagement</h2>
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
        <div>
          <label htmlFor="care-reason" className={LABEL}>
            Why you are reaching out
          </label>
          <select id="care-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={FIELD}>
            <option value="">Pick one</option>
            {CARE_REASONS.map((r) => (
              <option key={r} value={r}>
                {CARE_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
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
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={memberWroteFirst} onChange={(e) => setMemberWroteFirst(e.target.checked)} />
        They wrote to me first
      </label>
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
        {pending ? "Starting…" : "Start engagement"}
      </button>
    </form>
  );
}
