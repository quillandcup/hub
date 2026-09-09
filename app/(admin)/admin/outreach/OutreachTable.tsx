"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";
import { SortableTh } from "@/components/SortableTh";
import { useTableSort } from "@/lib/hooks/useTableSort";
import { etDate } from "@/lib/community-stats";

export type LeadStatus = "hot" | "warm" | "cold";

export interface OutreachLead {
  id: string;
  name: string;
  email: string;
  photoUrl: string | null;
  instagramUrl: string | null;
  memberStatus: string;
  outreachStatus: LeadStatus;
  outreachUpdatedAt: string | null;
  lastTouchedAt: string | null;
}

interface OutreachTableProps {
  leads: OutreachLead[];
  initialTodayCount: number;
}

// Target from the sales/marketing outreach workflow — deliberately separate
// from the operations "Work Queue" (hiatus nudges, hedgieversaries, etc. —
// see lib/admin-work-queue.ts): outreach touches are a repeating daily
// effort log (outreach_touches), not one-off dated occurrences per member.
const DAILY_OUTREACH_GOAL = 25;

function todayET(): string {
  return etDate(new Date().toISOString());
}

function isTouchedToday(lastTouchedAt: string | null): boolean {
  return !!lastTouchedAt && etDate(lastTouchedAt) === todayET();
}

function formatLastTouch(lastTouchedAt: string | null): string {
  if (!lastTouchedAt) return "Never";
  const day = etDate(lastTouchedAt);
  const today = todayET();
  if (day === today) return "Today";
  const yesterday = etDate(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  if (day === yesterday) return "Yesterday";
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
  return `${days}d ago`;
}

const STATUS_META: Record<LeadStatus, { label: string; badgeClass: string; buttonClass: string }> = {
  hot: {
    label: "Hot",
    badgeClass: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    buttonClass: "bg-red-600 hover:bg-red-700 text-white",
  },
  warm: {
    label: "Warm",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    buttonClass: "bg-amber-500 hover:bg-amber-600 text-white",
  },
  cold: {
    label: "Cold",
    badgeClass: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    buttonClass: "bg-slate-500 hover:bg-slate-600 text-white",
  },
};

const STATUS_ORDER: Record<LeadStatus, number> = { hot: 0, warm: 1, cold: 2 };

// Kajabi's socials.instagram is stored as a full profile URL
// (toSocialUrl in app/api/process/members/route.ts) — pull the @handle back
// out for the DM deep link, which needs the bare handle, not the URL.
function instagramHandle(instagramUrl: string | null): string | null {
  if (!instagramUrl) return null;
  const match = instagramUrl.match(/instagram\.com\/([^/?#]+)/i);
  return match ? match[1] : null;
}

function isOutreachEligible(lead: OutreachLead, includeFormerMembers: boolean): boolean {
  if (lead.memberStatus === "lead") return true;
  return includeFormerMembers && lead.memberStatus === "cancelled";
}

// Today's Queue is capped at DAILY_OUTREACH_GOAL total — the whole point is
// that the actionable view never grows past the daily target, no matter how
// large the backlog gets. Anyone already touched today always stays visible
// (so completed work doesn't vanish mid-session), and the remaining slots
// are filled with the stalest not-yet-touched leads (never-touched sorts
// first). Untouched leads are never "carried over" as a growing backlog —
// they simply stay at the front of the staleness ranking and surface again
// whenever a future day's queue is computed.
function selectTodaysQueue(rows: OutreachLead[], includeFormerMembers: boolean, goal: number): OutreachLead[] {
  const eligible = rows.filter((lead) => isOutreachEligible(lead, includeFormerMembers) && instagramHandle(lead.instagramUrl));
  const touchedToday = eligible.filter((lead) => isTouchedToday(lead.lastTouchedAt));
  const stale = eligible
    .filter((lead) => !isTouchedToday(lead.lastTouchedAt))
    .sort((a, b) => (a.lastTouchedAt ? Date.parse(a.lastTouchedAt) : 0) - (b.lastTouchedAt ? Date.parse(b.lastTouchedAt) : 0));
  const remainingSlots = Math.max(0, goal - touchedToday.length);
  return [...touchedToday, ...stale.slice(0, remainingSlots)];
}

type ViewMode = "queue" | "all";

type SortColumn = "name" | "email" | "outreachStatus" | "lastTouchedAt";

function getSortValue(lead: OutreachLead, column: SortColumn): string | number {
  switch (column) {
    case "name":
      return lead.name.toLowerCase();
    case "email":
      return lead.email.toLowerCase();
    case "outreachStatus":
      return STATUS_ORDER[lead.outreachStatus];
    case "lastTouchedAt":
      // Never-touched sorts first ascending — that's who to work next.
      return lead.lastTouchedAt ? new Date(lead.lastTouchedAt).getTime() : 0;
  }
}

function StatusButtons({
  status,
  busy,
  onChange,
}: {
  status: LeadStatus;
  busy: boolean;
  onChange: (status: LeadStatus) => void;
}) {
  return (
    <div className="inline-flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
      {(Object.keys(STATUS_META) as LeadStatus[]).map((option) => {
        const meta = STATUS_META[option];
        const active = status === option;
        return (
          <button
            key={option}
            onClick={() => onChange(option)}
            disabled={busy || active}
            className={`px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-default ${
              active
                ? meta.buttonClass
                : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}

export default function OutreachTable({ leads, initialTodayCount }: OutreachTableProps) {
  const router = useRouter();
  const [rows, setRows] = useState(leads);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [instagramOnly, setInstagramOnly] = useState(false);
  const [includeFormerMembers, setIncludeFormerMembers] = useState(false);
  const [todayCount, setTodayCount] = useState(initialTodayCount);
  const [viewMode, setViewMode] = useState<ViewMode>("queue");
  const [doneForToday, setDoneForToday] = useState(false);

  const { sortColumn, sortDirection, handleSort, sortedRows } = useTableSort<OutreachLead, SortColumn>({
    rows,
    getSortValue,
    defaultSort: { column: "outreachStatus", direction: "asc" },
  });

  const todaysQueueIds = useMemo(() => {
    const queue = selectTodaysQueue(rows, includeFormerMembers, DAILY_OUTREACH_GOAL);
    return new Set(queue.map((lead) => lead.id));
  }, [rows, includeFormerMembers]);

  const visibleRows = sortedRows.filter((lead) => {
    if (viewMode === "queue") {
      if (!todaysQueueIds.has(lead.id)) return false;
      if (doneForToday && !isTouchedToday(lead.lastTouchedAt)) return false;
      return true;
    }
    if (!includeFormerMembers && lead.memberStatus === "cancelled") return false;
    if (instagramOnly && !instagramHandle(lead.instagramUrl)) return false;
    return true;
  });

  const updateStatus = async (memberId: string, status: LeadStatus) => {
    setBusyId(memberId);
    setError(null);
    // Optimistic update — the buttons disable the active option, so a failed
    // request is rare, but revert on error rather than leaving a false state.
    const previous = rows;
    setRows((r) => r.map((lead) => (lead.id === memberId ? { ...lead, outreachStatus: status } : lead)));
    try {
      const response = await fetch("/api/admin/outreach-leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to update outreach status");
      router.refresh();
    } catch (err: any) {
      setRows(previous);
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const logTouch = async (memberId: string) => {
    setBusyId(memberId);
    setError(null);
    const previous = rows;
    const optimisticTouchedAt = new Date().toISOString();
    setRows((r) => r.map((lead) => (lead.id === memberId ? { ...lead, lastTouchedAt: optimisticTouchedAt } : lead)));
    try {
      const response = await fetch("/api/admin/outreach-touches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to log outreach");
      setRows((r) =>
        r.map((lead) => (lead.id === memberId ? { ...lead, lastTouchedAt: data.touch.touched_at } : lead))
      );
      setTodayCount((c) => c + 1);
    } catch (err: any) {
      setRows(previous);
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-200 text-sm">
          {error}
        </div>
      )}

      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Today&rsquo;s outreach: {todayCount} / {DAILY_OUTREACH_GOAL}
          </span>
          <div className="flex items-center gap-3">
            {todayCount >= DAILY_OUTREACH_GOAL && (
              <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                🎉 Goal hit!
              </span>
            )}
            {viewMode === "queue" && (
              <button
                onClick={() => setDoneForToday((d) => !d)}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
              >
                {doneForToday ? "Keep going" : "Done for today"}
              </button>
            )}
          </div>
        </div>
        <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <div
            className="h-full bg-blue-600 transition-all"
            style={{ width: `${Math.min(100, (todayCount / DAILY_OUTREACH_GOAL) * 100)}%` }}
          />
        </div>
      </div>

      <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="inline-flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
          {(["queue", "all"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                viewMode === mode
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              {mode === "queue" ? `Today's Queue (${todaysQueueIds.size})` : `All Leads (${rows.length})`}
            </button>
          ))}
        </div>
        {viewMode === "all" && (
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={instagramOnly}
              onChange={(e) => setInstagramOnly(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
            />
            Only show leads with Instagram ({rows.filter((lead) => instagramHandle(lead.instagramUrl)).length})
          </label>
        )}
        <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={includeFormerMembers}
            onChange={(e) => setIncludeFormerMembers(e.target.checked)}
            className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
          />
          Include former members ({rows.filter((lead) => lead.memberStatus === "cancelled").length})
        </label>
      </div>

      {viewMode === "queue" && doneForToday && (
        <div className="mx-6 mt-4 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg text-emerald-800 dark:text-emerald-200 text-sm">
          Nice work — you&rsquo;re done for today ({todayCount}/{DAILY_OUTREACH_GOAL}). Anyone you haven&rsquo;t
          reached stays at the front of tomorrow&rsquo;s queue.
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <SortableTh
                label="Hedgie"
                active={sortColumn === "name"}
                direction={sortDirection}
                onClick={() => handleSort("name")}
              />
              <SortableTh
                label="Email"
                active={sortColumn === "email"}
                direction={sortDirection}
                onClick={() => handleSort("email")}
              />
              <SortableTh
                label="Status"
                active={sortColumn === "outreachStatus"}
                direction={sortDirection}
                onClick={() => handleSort("outreachStatus")}
              />
              <SortableTh
                label="Last Touch"
                active={sortColumn === "lastTouchedAt"}
                direction={sortDirection}
                onClick={() => handleSort("lastTouchedAt")}
              />
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Instagram
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                  {viewMode === "queue" && doneForToday
                    ? "You're all caught up for today."
                    : viewMode === "queue"
                      ? "No leads in today's queue — try including former members."
                      : "No leads match the current filters."}
                </td>
              </tr>
            )}
            {visibleRows.map((lead) => {
              const handle = instagramHandle(lead.instagramUrl);
              const busy = busyId === lead.id;
              return (
                <tr key={lead.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <MemberAvatar name={lead.name} photoUrl={lead.photoUrl} size={36} />
                      <Link
                        href={`/admin/members/${lead.id}`}
                        className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
                      >
                        {lead.name}
                      </Link>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-400">
                    {lead.email}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <StatusButtons
                      status={lead.outreachStatus}
                      busy={busy}
                      onChange={(status) => updateStatus(lead.id, status)}
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-500 dark:text-slate-400">
                        {formatLastTouch(lead.lastTouchedAt)}
                      </span>
                      <button
                        onClick={() => logTouch(lead.id)}
                        disabled={busy || isTouchedToday(lead.lastTouchedAt)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors disabled:cursor-default ${
                          isTouchedToday(lead.lastTouchedAt)
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                            : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300"
                        }`}
                      >
                        {isTouchedToday(lead.lastTouchedAt) ? "✓ Logged" : "Log Outreach"}
                      </button>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                      <a
                        href={handle ? lead.instagramUrl! : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-disabled={!handle}
                        title={handle ? "View Instagram profile" : "No Instagram on file"}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                          handle
                            ? "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300"
                            : "bg-slate-50 dark:bg-slate-800/50 text-slate-300 dark:text-slate-600 cursor-not-allowed pointer-events-none"
                        }`}
                      >
                        Profile
                      </a>
                      <a
                        href={handle ? `https://ig.me/m/${handle}` : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-disabled={!handle}
                        title={
                          handle
                            ? "Open a DM with this lead — from whichever Instagram account is logged in on this device"
                            : "No Instagram on file"
                        }
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                          handle
                            ? "bg-blue-600 hover:bg-blue-700 text-white"
                            : "bg-slate-50 dark:bg-slate-800/50 text-slate-300 dark:text-slate-600 cursor-not-allowed pointer-events-none"
                        }`}
                      >
                        DM
                      </a>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
