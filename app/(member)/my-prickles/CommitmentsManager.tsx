"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_COMMITMENT_WEEKS,
  MAX_COMMITMENT_WEEKS,
  MIN_COMMITMENT_WEEKS,
  commitmentOccurrenceDates,
  type CommitmentSlotOption,
  type OccurrenceStatus,
} from "@/lib/commitments";
import { cancelCommitment, createCommitment, type MyCommitment } from "./commitment-actions";

interface Props {
  slots: CommitmentSlotOption[];
  commitments: MyCommitment[];
  /** Preselected slot (from a "Commit" link on the All Prickles table). */
  initialSlotKey?: string | null;
}

const WEEK_CHOICES = Array.from(
  { length: MAX_COMMITMENT_WEEKS - MIN_COMMITMENT_WEEKS + 1 },
  (_, i) => MIN_COMMITMENT_WEEKS + i
);

const OCCURRENCE_STYLES: Record<OccurrenceStatus, { className: string; label: string }> = {
  kept: { className: "bg-emerald-500", label: "Kept" },
  missed: { className: "bg-rose-400", label: "Missed" },
  pending: { className: "bg-amber-300", label: "Waiting on attendance" },
  upcoming: { className: "bg-slate-200 dark:bg-slate-700", label: "Upcoming" },
  no_session: { className: "bg-slate-100 dark:bg-slate-800 border border-dashed border-slate-300 dark:border-slate-600", label: "No session that week" },
};

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${dateStr}T00:00:00Z`)
  );
}

function progressSummary(c: MyCommitment): string {
  const { kept, missed, pending, upcoming } = c.progress;
  const parts = [`${kept} kept`];
  if (missed > 0) parts.push(`${missed} missed`);
  if (pending > 0) parts.push(`${pending} pending`);
  if (upcoming > 0) parts.push(`${upcoming} to go`);
  return parts.join(" · ");
}

function OccurrenceDots({ commitment }: { commitment: MyCommitment }) {
  return (
    <ul className="flex gap-1.5 mt-2" aria-label="Weekly progress">
      {commitment.progress.occurrences.map((o) => {
        const style = OCCURRENCE_STYLES[o.status];
        const text = `${formatDate(o.date)}: ${style.label}`;
        return (
          <li key={o.date} title={text} aria-label={text} className={`h-3 w-3 rounded-full ${style.className}`} />
        );
      })}
    </ul>
  );
}

function CommitmentCard({ commitment, onCancelled }: { commitment: MyCommitment; onCancelled: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel() {
    setBusy(true);
    setError(null);
    const result = await cancelCommitment(commitment.id);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onCancelled();
  }

  return (
    <li className="py-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{commitment.label}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {commitment.weeks} {commitment.weeks === 1 ? "week" : "weeks"} · {formatDate(commitment.startDate)} –{" "}
            {formatDate(commitment.endDate)}
            {commitment.status === "cancelled" && " · cancelled"}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{progressSummary(commitment)}</p>
          <OccurrenceDots commitment={commitment} />
        </div>
        {commitment.status === "active" &&
          (confirming ? (
            <div className="flex gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={handleCancel}
                disabled={busy}
                className="text-xs px-2 py-1 rounded bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {busy ? "Cancelling…" : "Yes, cancel"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600"
              >
                Keep it
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-xs text-slate-500 hover:text-rose-600 dark:text-slate-400 flex-shrink-0"
            >
              Cancel
            </button>
          ))}
      </div>
      {error && <p className="text-xs text-rose-600 mt-1">{error}</p>}
    </li>
  );
}

export default function CommitmentsManager({ slots, commitments, initialSlotKey }: Props) {
  const router = useRouter();
  const initialSlot = slots.find((s) => s.key === initialSlotKey) ?? null;

  const [slotKey, setSlotKey] = useState(initialSlot?.key ?? "");
  const [weeks, setWeeks] = useState(DEFAULT_COMMITMENT_WEEKS);
  const [startDate, setStartDate] = useState(initialSlot?.nextDate ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const selected = slots.find((s) => s.key === slotKey) ?? null;
  const active = commitments.filter((c) => c.status === "active");
  const past = commitments.filter((c) => c.status !== "active");

  const preview = useMemo(() => {
    if (!selected || !startDate) return null;
    const dates = commitmentOccurrenceDates({ startDate, dayOfWeek: selected.dayOfWeek, weeks });
    return `${dates.length} ${dates.length === 1 ? "session" : "sessions"}: ${formatDate(dates[0])}${
      dates.length > 1 ? ` – ${formatDate(dates[dates.length - 1])}` : ""
    }`;
  }, [selected, startDate, weeks]);

  function handleSlotChange(key: string) {
    setSlotKey(key);
    setSaved(false);
    const slot = slots.find((s) => s.key === key);
    if (slot) setStartDate(slot.nextDate);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) {
      setError("Pick a prickle to commit to");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await createCommitment({
      typeId: selected.typeId,
      dayOfWeek: selected.dayOfWeek,
      startTimeLocal: selected.startTimeLocal,
      timezone: selected.timezone,
      startDate,
      weeks,
    });
    setSubmitting(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSaved(true);
    setSlotKey("");
    setStartDate("");
    setWeeks(DEFAULT_COMMITMENT_WEEKS);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 space-y-4"
      >
        <div>
          <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            Make a commitment
          </h2>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            Pick a recurring prickle and how many weeks you&apos;ll show up for it. We&apos;ll track which weeks you
            made it.
          </p>
        </div>

        {slots.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No recurring prickles are on the schedule right now.</p>
        ) : (
          <>
            <label className="block text-sm">
              <span className="text-slate-700 dark:text-slate-300">Prickle</span>
              <select
                value={slotKey}
                onChange={(e) => handleSlotChange(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
              >
                <option value="">Choose a weekly prickle…</option>
                {slots.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-wrap gap-4">
              <label className="block text-sm">
                <span className="text-slate-700 dark:text-slate-300">For</span>
                <select
                  value={weeks}
                  onChange={(e) => setWeeks(Number(e.target.value))}
                  className="mt-1 block px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
                >
                  {WEEK_CHOICES.map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? "week" : "weeks"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-slate-700 dark:text-slate-300">Starting</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="mt-1 block px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
                />
              </label>
            </div>

            {preview && <p className="text-xs text-slate-500 dark:text-slate-400">{preview}</p>}
            {error && (
              <p role="alert" className="text-sm text-rose-600">
                {error}
              </p>
            )}
            {saved && <p className="text-sm text-emerald-600">Commitment saved. You&apos;ve got this!</p>}

            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Commit"}
            </button>
          </>
        )}
      </form>

      <section className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6">
        <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
          Active commitments
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No active commitments yet.</p>
        ) : (
          <ul>
            {active.map((c) => (
              <CommitmentCard key={c.id} commitment={c} onCancelled={() => router.refresh()} />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6">
          <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
            Past commitments
          </h2>
          <ul>
            {past.map((c) => (
              <CommitmentCard key={c.id} commitment={c} onCancelled={() => router.refresh()} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
