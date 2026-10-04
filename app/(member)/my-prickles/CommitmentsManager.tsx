"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { OccurrenceStatus, ProgressCounts } from "@/lib/commitments";
import { cancelCommitment, type MyCommitment } from "./commitment-actions";

// Commitments are made from All Prickles (pick slots from the table/calendar, then choose weeks;
// see CommitPanel). This tab lists them with progress, and lets members cancel active ones.

const OCCURRENCE_STYLES: Record<OccurrenceStatus, { className: string; label: string }> = {
  kept: { className: "bg-emerald-500", label: "Kept" },
  missed: { className: "bg-rose-400", label: "Missed" },
  pending: { className: "bg-amber-300", label: "Waiting on attendance" },
  upcoming: { className: "bg-slate-200 dark:bg-slate-700", label: "Upcoming" },
  no_session: {
    className: "bg-slate-100 dark:bg-slate-800 border border-dashed border-slate-300 dark:border-slate-600",
    label: "No session that week",
  },
};

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${dateStr}T00:00:00Z`)
  );
}

function progressSummary({ kept, missed, pending, upcoming }: ProgressCounts): string {
  const parts = [`${kept} kept`];
  if (missed > 0) parts.push(`${missed} missed`);
  if (pending > 0) parts.push(`${pending} pending`);
  if (upcoming > 0) parts.push(`${upcoming} to go`);
  return parts.join(" · ");
}

function OccurrenceDots({ commitment, slotIndex }: { commitment: MyCommitment; slotIndex: number }) {
  const occurrences = commitment.progress.occurrences.filter((o) => o.slotIndex === slotIndex);
  return (
    <ul className="flex gap-1.5" aria-label={`${commitment.slots[slotIndex].label} weekly progress`}>
      {occurrences.map((o) => {
        const style = OCCURRENCE_STYLES[o.status];
        const text = `${formatDate(o.date)}: ${style.label}`;
        return <li key={o.date} title={text} aria-label={text} className={`h-3 w-3 rounded-full ${style.className}`} />;
      })}
    </ul>
  );
}

function CommitmentCard({ commitment, onCancelled }: { commitment: MyCommitment; onCancelled: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const multi = commitment.slots.length > 1;

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
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{commitment.title}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {commitment.weeks} {commitment.weeks === 1 ? "week" : "weeks"} · {formatDate(commitment.startDate)} –{" "}
            {formatDate(commitment.endDate)}
            {commitment.status === "cancelled" && " · cancelled"}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{progressSummary(commitment.progress)}</p>
          <div className="mt-2 space-y-1.5">
            {commitment.slots.map((slot, i) => (
              <div key={`${slot.dayOfWeek}-${slot.startTimeLocal}-${slot.typeId}`} className="flex items-center gap-3">
                {multi && (
                  <span className="text-xs text-slate-500 dark:text-slate-400 w-48 truncate" title={slot.label}>
                    {slot.label.split(" · ").slice(1).join(" · ")}
                  </span>
                )}
                <OccurrenceDots commitment={commitment} slotIndex={i} />
                {multi && (
                  <span className="text-xs text-slate-400 dark:text-slate-500">{slot.progress.kept} kept</span>
                )}
              </div>
            ))}
          </div>
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

export default function CommitmentsManager({ commitments }: { commitments: MyCommitment[] }) {
  const router = useRouter();
  const active = commitments.filter((c) => c.status === "active");
  const past = commitments.filter((c) => c.status !== "active");

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6">
        <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
          <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            Active commitments
          </h2>
          <Link
            href="/my-prickles/all?commit="
            className="text-sm text-plum-600 dark:text-plum-400 hover:underline"
          >
            📌 Make a commitment →
          </Link>
        </div>
        {active.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No active commitments yet. Pick the prickles you&apos;ll show up to from{" "}
            <Link href="/my-prickles/all?commit=" className="text-plum-600 dark:text-plum-400 hover:underline">
              All Prickles
            </Link>{" "}
            and choose how many weeks, and we&apos;ll track which ones you made.
          </p>
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
