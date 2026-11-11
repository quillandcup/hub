"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import DatePicker from "@/components/DatePicker";
import { track } from "@/lib/analytics/client";
import {
  CONVERSATION_CHANNEL_LABELS,
  CONVERSATION_NEXT_STEP_MAX,
  CONVERSATION_NOTES_MAX,
  CONVERSATION_OUTCOMES,
  CONVERSATION_OUTCOME_LABELS,
  CONVERSATION_REASONS,
  CONVERSATION_REASON_LABELS,
  CONVERSATION_STATUS_LABELS,
  isConversationChannel,
  isConversationOutcome,
  isConversationReason,
  type ConversationStatus,
  type MessageDirection,
} from "@/lib/conversations";
import { formatDateOnly } from "@/lib/formatters";
import type { ConversationCardData } from "./card";
import { closeConversation, deleteConversation, logConversationMessage, updateConversation, type ConversationActionResult } from "./actions";

const FIELD = "w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-sm";
const BUTTON =
  "rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800";

const STATUS_STYLE: Record<ConversationStatus, string> = {
  needs_reply: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
  waiting: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  gone_quiet: "bg-yellow-50 text-yellow-900 dark:bg-yellow-900/20 dark:text-yellow-200",
  closed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

/** One conversation: who, why, where it stands, and the few things she does with it (log a reply, set a follow-up, close). */
export default function ConversationCard({ card, canWrite }: { card: ConversationCardData; canWrite: boolean }) {
  const [panel, setPanel] = useState<"edit" | "close" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [reason, setReason] = useState(card.reason);
  const [notes, setNotes] = useState(card.notes ?? "");
  const [nextStep, setNextStep] = useState(card.nextStep ?? "");
  const [followUpOn, setFollowUpOn] = useState(card.followUpOn ?? "");
  const [outcome, setOutcome] = useState("");

  const closed = card.status === "closed";

  function run(action: () => Promise<ConversationActionResult>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if ("error" in result) return setError(result.error);
      onDone?.();
    });
  }

  const logMessage = (direction: MessageDirection) =>
    run(
      () => logConversationMessage(card.id, direction),
      () => track("conversation_message_logged", { direction })
    );

  const save = () =>
    run(
      () => updateConversation(card.id, { reason, notes, nextStep, followUpOn }),
      () => setPanel(null)
    );

  const close = () => {
    if (!isConversationOutcome(outcome)) return setError("Pick how it ended.");
    const daysOpen = Math.min(3650, Math.max(0, Math.floor((Date.now() - Date.parse(card.openedAt)) / 86_400_000)));
    run(
      () => closeConversation(card.id, outcome),
      () => {
        track("conversation_closed", { outcome, days_open: daysOpen });
        setPanel(null);
      }
    );
  };

  const remove = () => {
    if (!window.confirm("Remove this conversation from the list?")) return;
    run(() => deleteConversation(card.id));
  };

  const channelLabel = isConversationChannel(card.channel) ? CONVERSATION_CHANNEL_LABELS[card.channel] : card.channel;
  const reasonLabel = isConversationReason(card.reason) ? CONVERSATION_REASON_LABELS[card.reason] : card.reason;
  const outcomeLabel = card.outcome && isConversationOutcome(card.outcome) ? CONVERSATION_OUTCOME_LABELS[card.outcome] : card.outcome;

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
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {card.followUpDue && (
            <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-200">
              Follow up due
            </span>
          )}
          <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLE[card.status]}`}>{CONVERSATION_STATUS_LABELS[card.status]}</span>
        </div>
      </div>

      <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
        {closed
          ? `${outcomeLabel ?? "Closed"}, closed ${card.closedLabel ?? ""}`.trim()
          : card.lastSpeaker === "member"
            ? `They wrote ${card.lastActivityLabel}`
            : card.lastSpeaker === "staff"
              ? `You wrote ${card.lastActivityLabel}`
              : `Started ${card.lastActivityLabel}`}
        {card.followUpOn && !closed && <span> · Follow up {formatDateOnly(card.followUpOn)}</span>}
      </p>
      {card.nextStep && !closed && <p className="mt-1 text-sm">Next: {card.nextStep}</p>}
      {card.notes && <p className="mt-1 whitespace-pre-line text-sm text-slate-600 dark:text-slate-400">{card.notes}</p>}

      {canWrite && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!closed && (
            <>
              <button type="button" data-track="conversation-they-replied" className={BUTTON} disabled={pending} onClick={() => logMessage("member")}>
                They replied
              </button>
              <button type="button" data-track="conversation-i-replied" className={BUTTON} disabled={pending} onClick={() => logMessage("staff")}>
                I replied
              </button>
            </>
          )}
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

      {canWrite && panel === "edit" && (
        <div className="mt-3 grid grid-cols-1 gap-3 @pair:grid-cols-2">
          <div>
            <label htmlFor={`reason-${card.id}`} className="mb-1 block text-sm font-medium">
              Why you are reaching out
            </label>
            <select id={`reason-${card.id}`} value={reason} onChange={(e) => setReason(e.target.value)} className={FIELD}>
              {CONVERSATION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {CONVERSATION_REASON_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <DatePicker id={`follow-up-${card.id}`} label="Follow up on" value={followUpOn} onChange={setFollowUpOn} />
          <div className="@pair:col-span-2">
            <label htmlFor={`next-${card.id}`} className="mb-1 block text-sm font-medium">
              Next step
            </label>
            <input id={`next-${card.id}`} value={nextStep} onChange={(e) => setNextStep(e.target.value)} maxLength={CONVERSATION_NEXT_STEP_MAX} className={FIELD} />
          </div>
          <div className="@pair:col-span-2">
            <label htmlFor={`notes-${card.id}`} className="mb-1 block text-sm font-medium">
              Note
            </label>
            <textarea id={`notes-${card.id}`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={CONVERSATION_NOTES_MAX} rows={3} className={FIELD} />
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
            <label htmlFor={`outcome-${card.id}`} className="mb-1 block text-sm font-medium">
              How did it end?
            </label>
            <select id={`outcome-${card.id}`} value={outcome} onChange={(e) => setOutcome(e.target.value)} className={FIELD}>
              <option value="">Pick one</option>
              {CONVERSATION_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {CONVERSATION_OUTCOME_LABELS[o]}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className={`${BUTTON} bg-plum-600 text-white hover:bg-plum-700`} disabled={pending} onClick={close}>
            Close conversation
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
