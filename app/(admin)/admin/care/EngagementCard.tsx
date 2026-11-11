"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import DatePicker from "@/components/DatePicker";
import { track } from "@/lib/analytics/client";
import {
  CARE_CHANNEL_LABELS,
  CARE_CLOSE_OPTIONS,
  CARE_ENDED_HOW_LABELS,
  CARE_NEXT_STEP_MAX,
  CARE_NOTES_MAX,
  CARE_REASONS,
  CARE_REASON_LABELS,
  CARE_STATUS_LABELS,
  isCareChannel,
  isCareEndedHow,
  isCareReason,
  isCloseOption,
  type CareResults,
  type CareStatus,
  type MessageDirection,
} from "@/lib/care";
import { formatDateOnly } from "@/lib/formatters";
import type { EngagementCardData } from "./card";
import EngagementResults from "./EngagementResults";
import {
  closeEngagement,
  deleteEngagement,
  getEngagementResults,
  logCareMessage,
  renewEngagement,
  updateEngagement,
  type CareActionResult,
} from "./actions";

const FIELD = "w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-sm";
const BUTTON =
  "rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800";

const STATUS_STYLE: Record<CareStatus, string> = {
  needs_reply: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
  review_due: "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200",
  waiting: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  gone_quiet: "bg-yellow-50 text-yellow-900 dark:bg-yellow-900/20 dark:text-yellow-200",
  lapsed: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  closed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

/** One engagement: who, why, where it stands, and the few things she does with it (log a reply, renew, set a follow-up, close, see results). */
export default function EngagementCard({ card, canWrite }: { card: EngagementCardData; canWrite: boolean }) {
  const [panel, setPanel] = useState<"edit" | "close" | "results" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CareResults | null>(null);
  const [pending, startTransition] = useTransition();

  const [reason, setReason] = useState(card.reason);
  const [notes, setNotes] = useState(card.notes ?? "");
  const [nextStep, setNextStep] = useState(card.nextStep ?? "");
  const [followUpOn, setFollowUpOn] = useState(card.followUpOn ?? "");
  const [endedHow, setEndedHow] = useState("");

  const closed = card.status === "closed";
  const ended = closed || card.status === "lapsed";
  const daysOpen = () => Math.min(3650, Math.max(0, Math.floor((Date.now() - Date.parse(card.openedAt)) / 86_400_000)));

  function run(action: () => Promise<CareActionResult>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if ("error" in result) return setError(result.error);
      onDone?.();
    });
  }

  const logMessage = (direction: MessageDirection) =>
    run(
      () => logCareMessage(card.id, direction),
      () => track("care_message_logged", { direction })
    );

  const save = () =>
    run(
      () => updateEngagement(card.id, { reason, notes, nextStep, followUpOn }),
      () => setPanel(null)
    );

  const renew = () =>
    run(
      () => renewEngagement(card.id),
      () => track("care_engagement_renewed", { days_open: daysOpen() })
    );

  const close = () => {
    if (!isCloseOption(endedHow)) return setError("Pick how it ended.");
    run(
      () => closeEngagement(card.id, endedHow),
      () => {
        track("care_engagement_closed", { ended_how: endedHow, days_open: daysOpen() });
        setPanel(null);
      }
    );
  };

  const remove = () => {
    if (!window.confirm("Remove this engagement from the lists?")) return;
    run(() => deleteEngagement(card.id));
  };

  const toggleResults = () => {
    if (panel === "results") return setPanel(null);
    setPanel("results");
    if (results) return;
    setError(null);
    startTransition(async () => {
      const answer = await getEngagementResults(card.id);
      if ("error" in answer) return setError(answer.error);
      setResults(answer.results);
    });
  };

  const channelLabel = isCareChannel(card.channel) ? CARE_CHANNEL_LABELS[card.channel] : card.channel;
  const reasonLabel = isCareReason(card.reason) ? CARE_REASON_LABELS[card.reason] : card.reason;
  const endedLabel = card.endedHow && isCareEndedHow(card.endedHow) ? CARE_ENDED_HOW_LABELS[card.endedHow] : card.endedHow;

  return (
    <li className="@container rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-2 @pair:flex-row @pair:items-start @pair:justify-between">
        <div>
          <Link href={`/admin/members/${card.memberId}`} className="font-semibold text-plum-700 hover:underline dark:text-plum-300">
            {card.memberName}
          </Link>
          {card.legalName && <span className="ml-2 text-xs text-slate-600 dark:text-slate-400">{card.legalName}</span>}
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {reasonLabel} · {channelLabel}
            {card.renewed && " · Renewed"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {card.followUpDue && (
            <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-200">
              Follow up due
            </span>
          )}
          <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLE[card.status]}`}>{CARE_STATUS_LABELS[card.status]}</span>
        </div>
      </div>

      <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
        {closed
          ? `${endedLabel ?? "Closed"}, closed ${card.closedLabel ?? ""}`.trim()
          : card.lastSpeaker === "member"
            ? `They wrote ${card.lastActivityLabel}`
            : card.lastSpeaker === "staff"
              ? `You wrote ${card.lastActivityLabel}`
              : `Started ${card.lastActivityLabel}`}
        <span> · {card.periodOver ? "Period ended" : "Period ends"} {formatDateOnly(card.periodEndsOn)}</span>
        {card.followUpOn && !ended && <span> · Follow up {formatDateOnly(card.followUpOn)}</span>}
      </p>
      {card.nextStep && !ended && <p className="mt-1 text-sm">Next: {card.nextStep}</p>}
      {card.notes && <p className="mt-1 whitespace-pre-line text-sm text-slate-600 dark:text-slate-400">{card.notes}</p>}
      {card.status === "review_due" && (
        <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">The period is over. Renew it to keep going, or close it.</p>
      )}

      {canWrite && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!closed && (
            <>
              <button type="button" data-track="care-they-replied" className={BUTTON} disabled={pending} onClick={() => logMessage("member")}>
                They replied
              </button>
              <button type="button" data-track="care-i-replied" className={BUTTON} disabled={pending} onClick={() => logMessage("staff")}>
                I replied
              </button>
              <button type="button" data-track="care-renew" className={BUTTON} disabled={pending} onClick={renew}>
                Renew
              </button>
            </>
          )}
          <button type="button" className={BUTTON} disabled={pending} onClick={toggleResults}>
            Results
          </button>
          <button type="button" className={BUTTON} disabled={pending} onClick={() => setPanel(panel === "edit" ? null : "edit")}>
            Edit
          </button>
          {!closed && (
            <button type="button" className={BUTTON} disabled={pending} onClick={() => setPanel(panel === "close" ? null : "close")}>
              Close
            </button>
          )}
          <button type="button" className={`${BUTTON} text-red-700 dark:text-red-300`} disabled={pending} onClick={remove}>
            Remove
          </button>
        </div>
      )}

      {canWrite && panel === "results" && (results ? <EngagementResults results={results} /> : !error && <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">Counting…</p>)}

      {canWrite && panel === "edit" && (
        <div className="mt-3 grid grid-cols-1 gap-3 @pair:grid-cols-2">
          <div>
            <label htmlFor={`reason-${card.id}`} className="mb-1 block text-sm font-medium">
              Why you are reaching out
            </label>
            <select id={`reason-${card.id}`} value={reason} onChange={(e) => setReason(e.target.value)} className={FIELD}>
              {CARE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {CARE_REASON_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <DatePicker id={`follow-up-${card.id}`} label="Follow up on" value={followUpOn} onChange={setFollowUpOn} />
          <div className="@pair:col-span-2">
            <label htmlFor={`next-${card.id}`} className="mb-1 block text-sm font-medium">
              Next step
            </label>
            <input id={`next-${card.id}`} value={nextStep} onChange={(e) => setNextStep(e.target.value)} maxLength={CARE_NEXT_STEP_MAX} className={FIELD} />
          </div>
          <div className="@pair:col-span-2">
            <label htmlFor={`notes-${card.id}`} className="mb-1 block text-sm font-medium">
              Note
            </label>
            <textarea id={`notes-${card.id}`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={CARE_NOTES_MAX} rows={3} className={FIELD} />
          </div>
          <div className="@pair:col-span-2">
            <button type="button" className={`${BUTTON} bg-plum-600 text-white hover:bg-plum-700`} disabled={pending} onClick={save}>
              Save
            </button>
          </div>
        </div>
      )}

      {canWrite && panel === "close" && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor={`ended-${card.id}`} className="mb-1 block text-sm font-medium">
              How did it end?
            </label>
            <select id={`ended-${card.id}`} value={endedHow} onChange={(e) => setEndedHow(e.target.value)} className={FIELD}>
              <option value="">Pick one</option>
              {CARE_CLOSE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {CARE_ENDED_HOW_LABELS[o]}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className={`${BUTTON} bg-plum-600 text-white hover:bg-plum-700`} disabled={pending} onClick={close}>
            Close engagement
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </li>
  );
}
