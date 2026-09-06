"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buildMembershipTimeline, type TimelineSegment } from "@/lib/membership-timeline";

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
  programOverrides?: ProgramOverrideRow[];
  statusOverrides?: StatusOverrideRow[];
}

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

function durationText(startDate: Date, endDate: Date | null): string {
  const end = endDate ?? new Date();
  // A segment can start after "now" — e.g. the active stretch queued up
  // after a hiatus whose scheduled return date hasn't arrived yet. There's
  // no duration to report for something that hasn't started.
  if (end.getTime() <= startDate.getTime()) return "upcoming";
  const durationDays = Math.floor((end.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const durationMonths = Math.floor(durationDays / 30);
  const suffix = endDate ? "" : " so far";
  if (durationMonths > 0) return `${durationMonths} month${durationMonths !== 1 ? "s" : ""}${suffix}`;
  return `${durationDays} day${durationDays !== 1 ? "s" : ""}${suffix}`;
}

const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function MemberTimelinePanel({
  memberId,
  hiatusHistory,
  membershipHistory,
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

  const [returnPromptId, setReturnPromptId] = useState<string | null>(null);
  const [returnDate, setReturnDate] = useState(todayDateOnly());

  const [editId, setEditId] = useState<string | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const currentHiatus = hiatusHistory.find((h) => h.end_date === null);

  const segments: TimelineSegment[] = buildMembershipTimeline(
    membershipHistory,
    hiatusHistory,
    programOverrides,
    statusOverrides
  );

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

  const handleEndNow = async (id: string, endOn: string) => {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/member-hiatus/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ end_date: endOn }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to end hiatus");
      setReturnPromptId(null);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const openReturnPrompt = (id: string) => {
    setReturnDate(todayDateOnly());
    setReturnPromptId(id);
  };

  const openEdit = (hiatus: HiatusRow) => {
    setReturnPromptId(null);
    setEditStart(hiatus.start_date);
    setEditEnd(hiatus.end_date ?? "");
    setEditReason(hiatus.reason ?? "");
    setEditNotes(hiatus.notes ?? "");
    setEditId(hiatus.id);
  };

  const cancelEdit = () => setEditId(null);

  const handleEditSubmit = async (e: React.FormEvent, id: string) => {
    e.preventDefault();
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/member-hiatus/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_date: editStart,
          end_date: editEnd || null,
          reason: editReason.trim() || null,
          notes: editNotes.trim() || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to update hiatus");
      setEditId(null);
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

        {segments.length === 0 && !showForm ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No membership, hiatus, or program history.</p>
        ) : (
          <div className="space-y-2">
            {segments.map((segment) => {
              const today = todayDateOnly();
              const endDateOnly = segment.endDate ? segment.endDate.toISOString().slice(0, 10) : null;
              const isCurrent = endDateOnly === null || endDateOnly > today;
              const key =
                segment.hiatus?.id ??
                `${segment.state}-${segment.startDate.toISOString()}-${segment.endDate?.toISOString() ?? "present"}`;

              if (segment.state === "gap") {
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between px-3 py-2 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500"
                  >
                    <span className="text-sm">
                      {fmt(segment.startDate)} → {segment.endDate ? fmt(segment.endDate) : "Present"}
                      <span className="ml-2 text-xs">not a member</span>
                    </span>
                    <span className="text-xs shrink-0">{durationText(segment.startDate, segment.endDate)}</span>
                  </div>
                );
              }

              if (segment.state === "hiatus") {
                const hiatus = segment.hiatus!;
                const showNotes = hiatus.reason || hiatus.notes;

                if (editId === hiatus.id) {
                  return (
                    <form
                      key={key}
                      onSubmit={(e) => handleEditSubmit(e, hiatus.id)}
                      className="p-4 border border-blue-200 dark:border-blue-800 rounded-lg bg-blue-50/60 dark:bg-blue-950/20 space-y-3"
                    >
                      <div className="flex flex-wrap gap-3">
                        <div>
                          <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1">Start date</label>
                          <input
                            type="date"
                            value={editStart}
                            onChange={(e) => setEditStart(e.target.value)}
                            required
                            className="px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1">End date (blank = ongoing)</label>
                          <input
                            type="date"
                            value={editEnd}
                            onChange={(e) => setEditEnd(e.target.value)}
                            className="px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm"
                          />
                        </div>
                      </div>
                      <input
                        type="text"
                        value={editReason}
                        onChange={(e) => setEditReason(e.target.value)}
                        placeholder="Reason (optional)"
                        className="w-full px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm"
                      />
                      <textarea
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        placeholder="Notes (optional)"
                        rows={2}
                        className="w-full px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm"
                      />
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={busyId === hiatus.id}
                          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium transition-colors"
                        >
                          {busyId === hiatus.id ? "Saving..." : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="px-4 py-1.5 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  );
                }

                return (
                  <div key={key}>
                    <div
                      className={`flex items-center justify-between p-3 rounded-lg border ${
                        isCurrent
                          ? "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800"
                          : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {fmt(segment.startDate)} → {segment.endDate ? fmt(segment.endDate) : "Present"}
                        </span>
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300">
                          on hiatus
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {durationText(segment.startDate, segment.endDate)}
                        </span>
                        {isCurrent && returnPromptId !== hiatus.id && (
                          <button
                            onClick={() => openReturnPrompt(hiatus.id)}
                            disabled={busyId === hiatus.id}
                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                          >
                            {endDateOnly ? "Return Early" : "End Now"}
                          </button>
                        )}
                        <button
                          onClick={() => {
                            const row = hiatusHistory.find((h) => h.id === hiatus.id);
                            if (row) openEdit(row);
                          }}
                          disabled={busyId === hiatus.id}
                          className="text-xs text-slate-600 dark:text-slate-400 hover:underline disabled:opacity-50"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(hiatus.id)}
                          disabled={busyId === hiatus.id}
                          className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {returnPromptId === hiatus.id && (
                      <div className="mt-2 flex items-center gap-2 p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/20">
                        <label className="text-xs text-slate-500 dark:text-slate-400" htmlFor={`return-date-${hiatus.id}`}>
                          Return on
                        </label>
                        <input
                          id={`return-date-${hiatus.id}`}
                          type="date"
                          value={returnDate}
                          onChange={(e) => setReturnDate(e.target.value)}
                          className="px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm"
                        />
                        <button
                          onClick={() => handleEndNow(hiatus.id, returnDate)}
                          disabled={busyId === hiatus.id || !returnDate}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-xs font-medium transition-colors"
                        >
                          {busyId === hiatus.id ? "Saving..." : "Confirm"}
                        </button>
                        <button
                          onClick={() => setReturnPromptId(null)}
                          className="text-xs text-slate-500 dark:text-slate-400 hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    {showNotes && (
                      <div className="pl-3 pt-1 flex flex-wrap gap-x-2 text-xs text-slate-500 dark:text-slate-500">
                        {hiatus.reason && <span>{hiatus.reason}</span>}
                        {hiatus.notes && <span>{hiatus.notes}</span>}
                      </div>
                    )}
                  </div>
                );
              }

              // Active. reasonTags[0] is always the primary driver
              // ("Membership", or the override/program that grants active
              // status on its own); anything after it is concurrent context
              // (e.g. a program running alongside a real subscription).
              const [primaryReason, ...extraReasons] = segment.reasonTags;
              return (
                <div
                  key={key}
                  className="flex items-center justify-between p-3 rounded-lg border bg-blue-50/60 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {fmt(segment.startDate)} → {segment.endDate ? fmt(segment.endDate) : "Present"}
                    </span>
                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                      active
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {primaryReason}
                      {extraReasons.length > 0 && ` + ${extraReasons.join(" + ")}`}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500 dark:text-slate-400 ml-4 shrink-0">
                    {durationText(segment.startDate, segment.endDate)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
