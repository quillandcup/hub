"use client";

import TimezoneSelect from "@/components/TimezoneSelect";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { useState, useEffect } from "react";
import Link from "next/link";
import { SortableTh } from "@/components/SortableTh";
import { useDataTable } from "@/lib/hooks/useDataTable";
import type { SortValue } from "@/lib/hooks/useTableSort";
import { DataTablePager } from "@/components/DataTablePager";
import { ORG_TIMEZONE } from "@/lib/config";
import { useWithSecondaryTime } from "@/components/SecondaryTimezone";
import type { PrickleRoster, RosterReason } from "@/lib/prickle-roster";
import type { PrickleDetail } from "@/lib/domain/prickle";
import { REASON_ICON } from "@/components/ReasonBadges";
import PrickleDescription from "@/components/PrickleDescription";
import PrickleEditForm, { type PrickleEditConfig } from "@/components/PrickleEditForm";

/** The same icons the prickle lists use (ReasonBadges), here worded for what another member did. */
const ROSTER_REASONS: Record<RosterReason, { icon: string; label: string }> = {
  host: { icon: REASON_ICON.hosting, label: "Hosting" },
  committed: { icon: REASON_ICON.commitment, label: "Committed" },
  calendar: { icon: REASON_ICON.calendar, label: "On their calendar" },
};

interface PrickleDetailsProps {
  prickle: PrickleDetail;
  attendanceRecords: any[];
  hostMissing: boolean;
  hostLate: boolean;
  userTimezonePreference?: string;
  memberBasePath: string;
  showMemberEmails: boolean;
  insightsSlotUrl?: string;
  /** Whether the prickle has started; one that hasn't has no attendance yet, which reads differently. */
  hasStarted?: boolean;
  /** For a prickle that hasn't started: who committed to it or added it to their calendar (lib/prickle-roster.ts). */
  roster?: PrickleRoster | null;
  /** Admin only: makes the card editable (an Edit button that turns the text into fields, with Save). */
  edit?: PrickleEditConfig;
}

type SortColumn = "member" | "join" | "leave" | "duration";

function getSortValue(record: any, column: SortColumn): SortValue {
  switch (column) {
    case "member":
      return record.members?.name?.toLowerCase() ?? null;
    case "join":
      return record.join_time;
    case "leave":
      return record.leave_time;
    case "duration":
      return (new Date(record.leave_time).getTime() - new Date(record.join_time).getTime()) / 60000;
  }
}

export default function PrickleDetails({
  prickle,
  attendanceRecords,
  hostMissing,
  hostLate,
  userTimezonePreference = "browser",
  memberBasePath,
  showMemberEmails,
  insightsSlotUrl,
  hasStarted = true,
  roster = null,
  edit,
}: PrickleDetailsProps) {
  const [editing, setEditing] = useState(false);
  const table = useDataTable<any, SortColumn>({
    rows: attendanceRecords,
    // Sort by the name the column shows.
    getSortValue: (record, column) =>
      column === "member" && record.members
        ? getMemberDisplayName(record.members).toLowerCase()
        : getSortValue(record, column),
    defaultSort: null,
  });
  const { sortColumn, sortDirection, handleSort } = table;
  const [detectedTimezone, setDetectedTimezone] = useState<string | null>(null);
  useEffect(() => {
    if (userTimezonePreference === "browser") {
      setDetectedTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
  }, [userTimezonePreference]);

  const defaultTimezone =
    userTimezonePreference === "browser"
      ? (detectedTimezone || ORG_TIMEZONE)
      : userTimezonePreference;

  const [timezone, setTimezone] = useState(defaultTimezone);
  const withSecondary = useWithSecondaryTime();

  useEffect(() => {
    setTimezone(defaultTimezone);
  }, [defaultTimezone]);

  const prickleType = prickle.type;
  const hostMember = prickle.host;
  const startTime = new Date(prickle.startTime);
  const endTime = new Date(prickle.endTime);
  const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);

  const uniqueMembers = new Set(attendanceRecords.map(r => r.member_id || r.members?.id)).size;

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    });
  };
  const formatTimeWithOrg = (date: Date) => withSecondary(formatTime(date), date, timezone);

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      timeZone: timezone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <div className="space-y-6">
      {/* Timezone Selector */}
      <div className="flex justify-end">
        <TimezoneSelect value={timezone} onChange={setTimezone} track="prickle-timezone" />
      </div>

      {/* Prickle Info */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 className="text-xl font-bold">{editing ? "Edit prickle" : prickle.title || "Prickle Details"}</h2>
          {edit && !editing && (
            <button type="button" onClick={() => setEditing(true)} className="text-sm text-plum-600 dark:text-plum-400 hover:underline flex-shrink-0">
              Edit
            </button>
          )}
        </div>
        {editing && edit && <div className="mb-4"><PrickleEditForm prickle={prickle} edit={edit} onDone={() => setEditing(false)} /></div>}
        {!editing && prickle.description && (
          <PrickleDescription markdown={prickle.description} />
        )}
        <div className="grid grid-cols-2 gap-4 text-sm">
          {!editing && (
          <div>
            <span className="text-slate-600 dark:text-slate-400">Type:</span>
            <p className="font-semibold text-slate-900 dark:text-slate-100">{prickleType?.name || "Unknown"}</p>
          </div>
          )}
          {!editing && (
          <div>
            <span className="text-slate-600 dark:text-slate-400">Host:</span>
            <p className="font-semibold">
              {hostMember ? (
                <>
                  <Link data-track="prickle-open-host" href={`${memberBasePath}/${hostMember.id}`} className="text-plum-600 hover:text-plum-700 dark:text-plum-400 hover:underline">
                    {getMemberDisplayName({ name: hostMember.name, display_name: hostMember.displayName })}
                  </Link>
                  {(hostMissing || hostLate) && (
                    <span className="ml-2" title={hostMissing ? "Host did not attend" : "Host was late (>5 min)"}>
                      ⚠️
                    </span>
                  )}
                  {hostMissing && (
                    <span className="ml-2 text-xs text-yellow-600 dark:text-yellow-400">
                      (did not attend)
                    </span>
                  )}
                  {hostLate && !hostMissing && (
                    <span className="ml-2 text-xs text-yellow-600 dark:text-yellow-400">
                      (late &gt;5 min)
                    </span>
                  )}
                </>
              ) : (
                <span className="text-slate-900 dark:text-slate-100">None</span>
              )}
            </p>
          </div>
          )}
          {!editing && prickle.guestSpeaker && (
            <div>
              <span className="text-slate-600 dark:text-slate-400">Guest speaker:</span>
              <p className="font-semibold text-slate-900 dark:text-slate-100">{prickle.guestSpeaker}</p>
            </div>
          )}
          {!editing && prickle.location && (
            <div>
              <span className="text-slate-600 dark:text-slate-400">Location:</span>
              <p className="font-semibold text-slate-900 dark:text-slate-100">{prickle.location}</p>
            </div>
          )}
          <div>
            <span className="text-slate-600 dark:text-slate-400">Date:</span>
            <p className="font-semibold text-slate-900 dark:text-slate-100">{formatDate(startTime)}</p>
          </div>
          <div>
            <span className="text-slate-600 dark:text-slate-400">Time:</span>
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {insightsSlotUrl ? (
                <Link data-track="prickle-open-insights" href={insightsSlotUrl} className="text-plum-600 hover:text-plum-700 dark:text-plum-400 hover:underline">
                  {formatTimeWithOrg(startTime)} - {formatTimeWithOrg(endTime)}
                </Link>
              ) : (
                <>{formatTime(startTime)} - {formatTime(endTime)}</>
              )}
              <span className="text-slate-600 dark:text-slate-400 ml-2">({durationMinutes} min)</span>
            </p>
          </div>
          <div>
            <span className="text-slate-600 dark:text-slate-400">Source:</span>
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {prickle.source === "calendar" ? "Google Calendar" : "Pop-Up Prickle (Zoom)"}
            </p>
          </div>
          <div>
            <span className="text-slate-600 dark:text-slate-400">Attendance:</span>
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {hasStarted ? (
                <>
                  {uniqueMembers} {uniqueMembers === 1 ? "attendee" : "attendees"}
                </>
              ) : (
                "Hasn't started yet"
              )}
            </p>
          </div>
        </div>
        {prickleType?.description && (
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
            <span className="text-slate-600 dark:text-slate-400 text-sm">About this type of prickle:</span>
            <p className="text-sm text-slate-700 dark:text-slate-300 mt-1">{prickleType.description}</p>
          </div>
        )}
      </div>

      {/* Attendance List */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-xl font-bold">{hasStarted ? `Attendees (${uniqueMembers})` : "Who's coming"}</h2>
          {attendanceRecords.length > uniqueMembers && (
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              {attendanceRecords.length} total records (some members left and rejoined)
            </p>
          )}
        </div>
        {attendanceRecords.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <SortableTh
                    label="Member"
                    active={sortColumn === "member"}
                    direction={sortDirection}
                    onClick={() => handleSort("member")}
                  />
                  <SortableTh
                    label="Join Time"
                    active={sortColumn === "join"}
                    direction={sortDirection}
                    onClick={() => handleSort("join")}
                  />
                  <SortableTh
                    label="Leave Time"
                    active={sortColumn === "leave"}
                    direction={sortDirection}
                    onClick={() => handleSort("leave")}
                  />
                  <SortableTh
                    label="Duration"
                    active={sortColumn === "duration"}
                    direction={sortDirection}
                    onClick={() => handleSort("duration")}
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {table.rows.map((record: any) => {
                  const member = record.members;
                  const joinTime = new Date(record.join_time);
                  const leaveTime = new Date(record.leave_time);
                  const attendDuration = Math.round((leaveTime.getTime() - joinTime.getTime()) / 60000);

                  return (
                    <tr key={record.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                      <td className="px-6 py-4">
                        <Link data-track="prickle-open-attendee" href={`${memberBasePath}/${member.id}`} className="text-sm font-medium text-plum-600 hover:text-plum-700 dark:text-plum-400 hover:underline">
                          {getMemberDisplayName(member)}
                        </Link>
                        {showMemberEmails && (
                          <div className="text-xs text-slate-600 dark:text-slate-400">
                            {[getMemberDisplayName(member) !== member.name ? member.name : null, member.email].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                        {formatTime(joinTime)}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                        {formatTime(leaveTime)}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                        {attendDuration} min
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <DataTablePager table={table} itemLabel="attendees" />
          </div>
        ) : !hasStarted && roster && roster.entries.length > 0 ? (
          <div className="px-6 py-4">
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
              The host, and members who&apos;ve committed to this prickle or added it to their calendar. It&apos;s not
              a sign-up: anyone can still join.
            </p>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {roster.entries.map((entry) => (
                <li key={entry.memberId} className="py-2 flex items-center gap-3 text-sm">
                  <span
                    role="img"
                    aria-label={ROSTER_REASONS[entry.reason].label}
                    title={ROSTER_REASONS[entry.reason].label}
                    className="w-6 shrink-0 text-center"
                  >
                    {ROSTER_REASONS[entry.reason].icon}
                  </span>
                  <span className="min-w-0">
                    <Link data-track="prickle-open-roster-member"
                      href={`${memberBasePath}/${entry.memberId}`}
                      className="font-medium text-plum-600 hover:text-plum-700 dark:text-plum-400 hover:underline"
                    >
                      {entry.name}
                    </Link>
                    {entry.isYou && (
                      <span className="ml-2 text-xs text-slate-600 dark:text-slate-400">
                        {entry.hiddenFromOthers ? "You (hidden from others)" : "You"}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
              {(["host", "committed", "calendar"] as const)
                .filter((reason) => roster.entries.some((e) => e.reason === reason))
                .map((reason) => `${ROSTER_REASONS[reason].icon} ${ROSTER_REASONS[reason].label}`)
                .join(" · ")}
            </p>
            {roster.total > roster.entries.length && (
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                and {roster.total - roster.entries.length} more
              </p>
            )}
            <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">
              Don&apos;t want to be listed?{" "}
              <Link data-track="prickle-change-it-in-your-profile" href="/settings/profile" className="underline">
                Change it in your profile settings
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="p-12 text-center text-slate-600 dark:text-slate-400">
            {hasStarted ? "No attendance records for this Prickle" : "Stay tuned to see who attends!"}
          </div>
        )}
      </div>

    </div>
  );
}
