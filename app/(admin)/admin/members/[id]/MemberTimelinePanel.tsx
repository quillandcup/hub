"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { gapLabelsByStintStart } from "@/lib/resubscription-detection";

interface HiatusRow {
  id: string;
  start_date: string;
  end_date: string | null;
  reason: string | null;
  notes: string | null;
}

// A member_program_enrollments row (see
// supabase/migrations/20260903000000_create_program_cohort_tracking.sql),
// flattened with its cohort's window and program name. starts_at/expires_at
// are the cohort's dates (DATE, not timestamptz); reason holds the program
// name (e.g. "180 Program") for display.
interface ProgramOverrideRow {
  id: string;
  starts_at: string;
  expires_at: string | null;
  reason: string | null;
}

// A member_status_overrides row ('gift', 'direct_stripe', or 'special' —
// see reprocess_members_atomic Step 4). Unlike a real Kajabi stint, this
// produces no membership-history row of its own, so without surfacing it
// here the timeline shows a gap during an active gifted/comped membership.
interface StatusOverrideRow {
  id: string;
  override_type: string;
  reason: string | null;
  starts_at: string;
  expires_at: string | null;
}

interface MemberTimelinePanelProps {
  memberId: string;
  hiatusHistory: HiatusRow[];
  membershipHistory: any[];
  firstJoinedAt?: string | null;
  programOverrides?: ProgramOverrideRow[];
  statusOverrides?: StatusOverrideRow[];
}

const OVERRIDE_TYPE_LABEL: Record<string, string> = {
  gift: "Gift",
  direct_stripe: "Direct Stripe",
  special: "Special",
};

type TimelineEvent =
  | {
      kind: "membership";
      key: string;
      startDate: Date;
      endDate: Date | null;
      isActive: boolean;
      gapLabel: string | null;
    }
  | {
      kind: "hiatus";
      key: string;
      id: string;
      startDate: Date;
      endDate: Date | null;
      reason: string | null;
      notes: string | null;
      activeLabel: string | null;
    }
  | {
      kind: "program";
      key: string;
      startDate: Date;
      endDate: Date | null;
      reason: string | null;
    }
  | {
      kind: "statusOverride";
      key: string;
      startDate: Date;
      endDate: Date | null;
      reason: string | null;
      overrideType: string;
    };

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

function durationText(startDate: Date, endDate: Date | null): string {
  const end = endDate ?? new Date();
  const durationDays = Math.floor((end.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const durationMonths = Math.floor(durationDays / 30);
  const suffix = endDate ? "" : " so far";
  if (durationMonths > 0) return `${durationMonths} month${durationMonths !== 1 ? "s" : ""}${suffix}`;
  return `${durationDays} day${durationDays !== 1 ? "s" : ""}${suffix}`;
}

const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const fmtMonthYear = (d: Date) => d.toLocaleDateString("en-US", { month: "short", year: "numeric" });

function formatActiveLabel(days: number): string {
  const months = Math.round(days / 30);
  if (months < 1) return `${days}d active`;
  if (months === 1) return "1 mo active";
  return `${months} mo active`;
}

// Mirrors gapLabelsByStintStart: labels the active stretch immediately
// before each hiatus began, using the previous hiatus's end (or first join,
// for the earliest hiatus) as the boundary.
function activeLabelsByHiatusStart(hiatusHistory: HiatusRow[], firstJoinedAt: string | null): Map<string, string> {
  const sorted = [...hiatusHistory].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const map = new Map<string, string>();
  sorted.forEach((hiatus, i) => {
    const previousEnd = i === 0 ? firstJoinedAt : sorted[i - 1].end_date;
    if (!previousEnd) return;
    const days = Math.floor(
      (new Date(hiatus.start_date).getTime() - new Date(previousEnd).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (days < 0) return;
    map.set(hiatus.start_date, formatActiveLabel(days));
  });
  return map;
}

export default function MemberTimelinePanel({
  memberId,
  hiatusHistory,
  membershipHistory,
  firstJoinedAt = null,
  programOverrides = [],
  statusOverrides = [],
}: MemberTimelinePanelProps) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [startDate, setStartDate] = useState(todayDateOnly());
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentHiatus = hiatusHistory.find((h) => h.end_date === null);
  const gapLabelByStart = gapLabelsByStintStart(membershipHistory);
  const activeLabelByHiatusStart = activeLabelsByHiatusStart(hiatusHistory, firstJoinedAt);

  const events: TimelineEvent[] = [
    ...membershipHistory.map((purchase: any): TimelineEvent => ({
      kind: "membership",
      key: `membership-${purchase.kajabi_offer_id}-${purchase.created_at_kajabi}`,
      startDate: new Date(purchase.created_at_kajabi),
      endDate: purchase.derived_end_at ? new Date(purchase.derived_end_at) : null,
      isActive: purchase.status === "active",
      gapLabel: gapLabelByStart.get(purchase.created_at_kajabi) ?? null,
    })),
    ...hiatusHistory.map((hiatus): TimelineEvent => ({
      kind: "hiatus",
      key: `hiatus-${hiatus.id}`,
      id: hiatus.id,
      startDate: new Date(hiatus.start_date),
      endDate: hiatus.end_date ? new Date(hiatus.end_date) : null,
      reason: hiatus.reason,
      notes: hiatus.notes,
      activeLabel: activeLabelByHiatusStart.get(hiatus.start_date) ?? null,
    })),
    ...programOverrides.map((override): TimelineEvent => ({
      kind: "program",
      key: `program-${override.id}`,
      startDate: new Date(override.starts_at),
      endDate: override.expires_at ? new Date(override.expires_at) : null,
      reason: override.reason,
    })),
    ...statusOverrides.map((override): TimelineEvent => ({
      kind: "statusOverride",
      key: `status-override-${override.id}`,
      startDate: new Date(override.starts_at),
      endDate: override.expires_at ? new Date(override.expires_at) : null,
      reason: override.reason,
      overrideType: override.override_type,
    })),
  ].sort((a, b) => b.startDate.getTime() - a.startDate.getTime());

  const resetForm = () => {
    setStartDate(todayDateOnly());
    setEndDate("");
    setReason("");
    setNotes("");
    setShowForm(false);
  };

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/member-hiatus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member_id: memberId,
          start_date: startDate,
          end_date: endDate || null,
          reason: reason.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to start hiatus");
      resetForm();
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEndNow = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/member-hiatus/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ end_date: todayDateOnly() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to end hiatus");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this hiatus record? This affects tenure/Hedgieversary calculations.")) return;
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/member-hiatus/${id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to delete hiatus");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <h2 className="text-xl font-bold">Membership Timeline</h2>
        {!currentHiatus && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Start Hiatus
          </button>
        )}
      </div>

      <div className="p-6 space-y-4">
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-200 text-sm">
            {error}
          </div>
        )}

        {showForm && (
          <form onSubmit={handleStart} className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 space-y-3">
            <div className="flex flex-wrap gap-3">
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1" htmlFor="hiatus-start">
                  Start date
                </label>
                <input
                  id="hiatus-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                  className="px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1" htmlFor="hiatus-end">
                  End date (optional)
                </label>
                <input
                  id="hiatus-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1" htmlFor="hiatus-reason">
                Reason (optional)
              </label>
              <input
                id="hiatus-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g., travel, burnout, medical"
                className="w-full px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1" htmlFor="hiatus-notes">
                Notes (optional)
              </label>
              <textarea
                id="hiatus-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {submitting ? "Saving..." : "Start Hiatus"}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-1.5 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {events.length === 0 && !showForm ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No membership, hiatus, or program history.</p>
        ) : (
          <div className="space-y-3">
            {events.map((event) => {
              if (event.kind === "program") {
                return (
                  <div key={event.key}>
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-indigo-50/60 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-900">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {event.reason ?? "Program"}: {fmtMonthYear(event.startDate)} –{" "}
                          {event.endDate ? fmtMonthYear(event.endDate) : "Present"}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              }

              if (event.kind === "statusOverride") {
                const typeLabel = OVERRIDE_TYPE_LABEL[event.overrideType] ?? event.overrideType;
                return (
                  <div key={event.key}>
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300">
                          {typeLabel}
                        </span>
                        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {event.reason ?? "Status override"}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500 dark:text-slate-400 ml-4 shrink-0">
                        {fmt(event.startDate)} → {event.endDate ? fmt(event.endDate) : "Present"}
                      </span>
                    </div>
                  </div>
                );
              }

              if (event.kind === "membership") {
                return (
                  <div key={event.key}>
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-blue-50/60 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {fmt(event.startDate)} → {event.endDate ? fmt(event.endDate) : "Present"}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                            event.isActive
                              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
                              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                          }`}
                        >
                          {event.isActive ? "active" : "cancelled"}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500 dark:text-slate-400 ml-4 shrink-0">
                        {durationText(event.startDate, event.endDate)}
                      </span>
                    </div>
                    {event.gapLabel && (
                      <div className="flex items-center gap-2 pl-4 mt-1 text-xs text-slate-400 dark:text-slate-500">
                        <span className="inline-block w-px h-3 bg-slate-300 dark:bg-slate-600" />
                        {event.gapLabel} before rejoining
                      </div>
                    )}
                  </div>
                );
              }

              // "Ongoing" means the hiatus hasn't ended yet — either it has
              // no end date at all (indefinite), or its end date is still
              // in the future (an admin can set a planned return date up
              // front when starting a hiatus, via the End date field
              // above). Comparing date-only strings sidesteps timezone
              // drift from parsing "YYYY-MM-DD" as UTC midnight.
              const endDateOnly = event.endDate ? event.endDate.toISOString().slice(0, 10) : null;
              const isOngoing = endDateOnly === null || endDateOnly > todayDateOnly();
              const showNotes = event.reason || event.notes;
              return (
                <div key={event.key}>
                  <div
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      isOngoing
                        ? "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800"
                        : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                    }`}
                  >
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {fmt(event.startDate)} → {event.endDate ? fmt(event.endDate) : "Ongoing"}
                      </span>
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300">
                        {isOngoing ? "on hiatus" : "hiatus"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {durationText(event.startDate, event.endDate)}
                      </span>
                      {isOngoing && (
                        <button
                          onClick={() => handleEndNow(event.id)}
                          disabled={busyId === event.id}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                        >
                          {busyId === event.id ? "Ending..." : endDateOnly ? "Return Early" : "End Now"}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(event.id)}
                        disabled={busyId === event.id}
                        className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  {showNotes && (
                    <div className="pl-3 pt-1 flex flex-wrap gap-x-2 text-xs text-slate-500 dark:text-slate-500">
                      {event.reason && <span>{event.reason}</span>}
                      {event.notes && <span>{event.notes}</span>}
                    </div>
                  )}
                  {event.activeLabel && (
                    <div className="flex items-center gap-2 pl-4 mt-1 text-xs text-slate-400 dark:text-slate-500">
                      <span className="inline-block w-px h-3 bg-slate-300 dark:bg-slate-600" />
                      {event.activeLabel} before hiatus
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
