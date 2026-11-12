"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import DatePicker from "@/components/DatePicker";
import EntitySearch from "@/components/EntitySearch";
import { track } from "@/lib/analytics/client";
import {
  CARE_CLOSE_OPTIONS,
  CARE_ENDED_HOW_HELP,
  CARE_ENDED_HOW_LABELS,
  CARE_NEXT_STEP_MAX,
  CARE_NOTES_MAX,
  CARE_REASONS,
  CARE_REASON_LABELS,
  CARE_STATUS_LABELS,
  isCareEndedHow,
  isCareReason,
  planOrdinal,
  isCloseOption,
  type CareResults,
  type CareStatus,
  type MessageDirection,
} from "@/lib/care";
import type { CareOwner } from "@/lib/care-owners";
import { formatDateOnly } from "@/lib/formatters";
import CareFacts from "./CareFacts";
import type { EngagementCardData } from "./card";
import EngagementResults from "./EngagementResults";
import {
  changeEngagementStart,
  closeEngagement,
  deleteEngagement,
  getEngagementResults,
  logCareMessage,
  reassignEngagement,
  renewEngagement,
  updateEngagement,
  type CareActionResult,
} from "./actions";

const FIELD = "w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-sm";
const BUTTON =
  "rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800";
const PRIMARY = `${BUTTON} bg-plum-600 text-white hover:bg-plum-700`;

const STATUS_STYLE: Record<CareStatus, string> = {
  needs_reply: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
  review_due: "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200",
  waiting: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  gone_quiet: "bg-yellow-50 text-yellow-900 dark:bg-yellow-900/20 dark:text-yellow-200",
  lapsed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200",
  closed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

type Panel = "edit" | "close" | "renew" | "results" | "reassign" | "start";

/** One care plan: who, why, where it stands, and the few things she does with it (log a reply, renew, hand it over, set a follow-up, change its start, close, see results). */
export default function EngagementCard({ card, canWrite, owners }: { card: EngagementCardData; canWrite: boolean; owners: readonly CareOwner[] }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CareResults | null>(null);
  const [pending, startTransition] = useTransition();

  const [reason, setReason] = useState(card.reason);
  const [notes, setNotes] = useState(card.notes ?? "");
  const [nextStep, setNextStep] = useState(card.nextStep ?? "");
  const [followUpOn, setFollowUpOn] = useState(card.followUpOn ?? "");
  const [endedHow, setEndedHow] = useState("");
  const [renewWhy, setRenewWhy] = useState("");
  const [startedOn, setStartedOn] = useState(card.startedOn);

  const closed = card.status === "closed";
  const daysOpen = () => Math.min(3650, Math.max(0, Math.floor((Date.now() - Date.parse(card.openedAt)) / 86_400_000)));

  function run(action: () => Promise<CareActionResult>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if ("error" in result) return setError(result.error);
      onDone?.();
    });
  }

  /** Loads the measured results the first time a panel that shows them opens. */
  function loadResults() {
    if (results) return;
    startTransition(async () => {
      const answer = await getEngagementResults(card.id);
      if ("error" in answer) return setError(answer.error);
      setResults(answer.results);
    });
  }

  function open(next: Panel) {
    if (panel === next) return setPanel(null);
    setError(null);
    setPanel(next);
    if (next === "results" || next === "close" || next === "renew") loadResults();
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

  const renew = () => {
    if (!renewWhy.trim()) return setError("Say why you are renewing: what will you do next?");
    run(
      () => renewEngagement(card.id, renewWhy),
      () => {
        track("care_engagement_renewed", { days_open: daysOpen() });
        setPanel(null);
      }
    );
  };

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

  const changeStart = () => {
    if (!startedOn) return setError("Pick the day it started.");
    const from = card.startedOn;
    run(
      () => changeEngagementStart(card.id, startedOn),
      () => {
        track("care_start_date_changed", { days_moved: Math.min(3650, Math.abs(Math.round((Date.parse(startedOn) - Date.parse(from)) / 86_400_000))) });
        setPanel(null);
      }
    );
  };

  const reassign = (ownerId: string) => run(() => reassignEngagement(card.id, ownerId), () => setPanel(null));

  const remove = () => {
    if (!window.confirm("Remove this care plan from the lists?")) return;
    run(() => deleteEngagement(card.id));
  };

  const reasonLabel = isCareReason(card.reason) ? CARE_REASON_LABELS[card.reason] : card.reason;
  const endedLabel = card.endedHow && isCareEndedHow(card.endedHow) ? CARE_ENDED_HOW_LABELS[card.endedHow] : card.endedHow;
  const ended = closed || card.status === "lapsed";

  const resultsBlock = results ? <EngagementResults results={results} /> : !error && <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">Counting…</p>;

  return (
    <li className="@container rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-2 @pair:flex-row @pair:items-start @pair:justify-between">
        <div>
          <Link href={`/admin/members/${card.memberId}`} className="font-semibold text-plum-700 hover:underline dark:text-plum-300">
            {card.memberName}
          </Link>
          {card.legalName && <span className="ml-2 text-xs text-slate-600 dark:text-slate-400">{card.legalName}</span>}
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {reasonLabel} · {planOrdinal(card.period)} plan
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-400">Owner: {card.ownerName}</p>
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
            ? `Last message: they wrote ${card.lastActivityLabel}`
            : card.lastSpeaker === "staff"
              ? `Last message: you wrote ${card.lastActivityLabel}`
              : "No message logged yet"}
        {card.fromSlack && !closed && (
          <span
            title="Kept up to date from your tracked Slack DM with them, so you don't need to log replies here"
            className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            from Slack
          </span>
        )}
        <span> · Started {formatDateOnly(card.startedOn)}</span>
        <span> · {card.periodOver ? "Care plan ended" : "Care plan ends"} {formatDateOnly(card.periodEndsOn)}</span>
        {card.followUpOn && !ended && <span> · Follow up {formatDateOnly(card.followUpOn)}</span>}
        {card.dmLink && (
          <>
            {" · "}
            {card.dmLink.kind === "hub_chat" ? (
              <Link href={card.dmLink.href} title="Opens the DM in Hub Chat" className="font-medium text-plum-700 underline dark:text-plum-300">
                Open the DM
              </Link>
            ) : (
              <a href={card.dmLink.href} target="_blank" rel="noopener noreferrer" title="Opens the DM in Slack" className="font-medium text-plum-700 underline dark:text-plum-300">
                Open the DM
              </a>
            )}
          </>
        )}
      </p>
      <CareFacts card={card} />
      {card.nextStep && !ended && <p className="mt-1 text-sm">Next: {card.nextStep}</p>}
      {card.notes && <p className="mt-1 whitespace-pre-line text-sm text-slate-600 dark:text-slate-400">{card.notes}</p>}
      {card.status === "review_due" && (
        <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">The care plan is over. Renew it to keep going, or close it.</p>
      )}
      {card.status === "lapsed" && (
        <p className="mt-1 text-sm text-red-700 dark:text-red-300">The care plan ended and nobody renewed or closed it. Renew it to keep going, or close it.</p>
      )}

      {canWrite && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!closed && (
            <>
              {card.fromSlack ? (
                <span className="self-center text-sm text-slate-600 dark:text-slate-400">Filled in from your Slack DM</span>
              ) : (
                <>
                  <button type="button" data-track="care-they-replied" className={BUTTON} disabled={pending} onClick={() => logMessage("member")}>
                    They replied
                  </button>
                  <button type="button" data-track="care-i-replied" className={BUTTON} disabled={pending} onClick={() => logMessage("staff")}>
                    I replied
                  </button>
                </>
              )}
              <button type="button" data-track="care-renew" className={BUTTON} disabled={pending} onClick={() => open("renew")}>
                Renew
              </button>
            </>
          )}
          <button type="button" className={BUTTON} disabled={pending} onClick={() => open("results")}>
            Results
          </button>
          <button type="button" className={BUTTON} disabled={pending} onClick={() => open("reassign")}>
            Reassign
          </button>
          <button type="button" className={BUTTON} disabled={pending} onClick={() => open("edit")}>
            Edit
          </button>
          <button type="button" data-track="care-change-start" className={BUTTON} disabled={pending} onClick={() => open("start")}>
            Change start date
          </button>
          {!closed && (
            <button type="button" className={BUTTON} disabled={pending} onClick={() => open("close")}>
              Close
            </button>
          )}
          <button type="button" className={`${BUTTON} text-red-700 dark:text-red-300`} disabled={pending} onClick={remove}>
            Remove
          </button>
        </div>
      )}

      {canWrite && !closed && (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Renew starts a new care plan for them. Close ends this one and asks how it ended.
        </p>
      )}

      {canWrite && panel === "results" && (
        <>
          <div className="mt-3">
            <CareFacts card={card} withHelp />
          </div>
          {resultsBlock}
        </>
      )}

      {canWrite && panel === "start" && (
        <div className="mt-3 space-y-2">
          <DatePicker id={`started-${card.id}`} label="When did this start?" value={startedOn} onChange={setStartedOn} max={card.today} />
          <p className="max-w-prose text-sm text-slate-600 dark:text-slate-400">
            Today or an earlier day. The care plan stays the same length, so its last day moves with the start. {card.fromSlack ? "Your Slack DM with them is used for who wrote last from that day on. " : ""}
            {card.renewed ? "The start can't be before the care plan this one follows on from. " : ""}
          </p>
          <button type="button" className={PRIMARY} disabled={pending} onClick={changeStart}>
            Save start date
          </button>
        </div>
      )}

      {canWrite && panel === "reassign" && (
        <div className="mt-3 max-w-sm">
          <span className="mb-1 block text-sm font-medium">Hand it to</span>
          <EntitySearch
            items={owners.filter((o) => o.id !== card.ownerId).map((o) => ({ id: o.id, name: o.name, detail: o.role === "admin" ? "Admin" : "Community manager" }))}
            selectedId={null}
            onSelect={(item) => item && reassign(item.id)}
            placeholder="Search the team"
            ariaLabel="Hand it to"
            browse
          />
        </div>
      )}

      {canWrite && panel === "renew" && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-slate-700 dark:text-slate-300">Renewing starts a new care plan of the same length, from today. Say why, so it is a decision and not a habit.</p>
          {resultsBlock}
          <div>
            <label htmlFor={`renew-${card.id}`} className="mb-1 block text-sm font-medium">
              Why renew? What will you do next?
            </label>
            <textarea id={`renew-${card.id}`} value={renewWhy} onChange={(e) => setRenewWhy(e.target.value)} maxLength={CARE_NOTES_MAX} rows={3} className={FIELD} />
          </div>
          <button type="button" className={PRIMARY} disabled={pending} onClick={renew}>
            Renew this care plan
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
            <button type="button" className={PRIMARY} disabled={pending} onClick={save}>
              Save
            </button>
          </div>
        </div>
      )}

      {canWrite && panel === "close" && (
        <div className="mt-3 space-y-3">
          <fieldset>
            <legend className="mb-1 text-sm font-medium">How did it end?</legend>
            <p className="mb-2 text-sm text-slate-600 dark:text-slate-400">The first one that fits. If it is still alive and you know what comes next, renew it instead.</p>
            <div className="space-y-2">
              {CARE_CLOSE_OPTIONS.map((option) => (
                <label key={option} className="flex items-start gap-2 text-sm">
                  <input type="radio" name={`ended-${card.id}`} value={option} checked={endedHow === option} onChange={() => setEndedHow(option)} className="mt-1" />
                  <span>
                    <span className="font-medium">{CARE_ENDED_HOW_LABELS[option]}</span>
                    <span className="block text-slate-600 dark:text-slate-400">{CARE_ENDED_HOW_HELP[option]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {resultsBlock}
          <button type="button" className={PRIMARY} disabled={pending} onClick={close}>
            Close this care plan
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
