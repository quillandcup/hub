"use client";

import { useState } from "react";
import Link from "next/link";

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "UTC", label: "UTC" },
];

interface PrickleDetailsProps {
  prickle: any;
  attendanceRecords: any[];
  hostMissing: boolean;
  hostLate: boolean;
}

export default function PrickleDetails({ prickle, attendanceRecords, hostMissing, hostLate }: PrickleDetailsProps) {
  const [timezone, setTimezone] = useState("America/New_York");

  const prickleType = prickle.prickle_types as any;
  const hostMember = prickle.host as any; // { id, name } or null
  const startTime = new Date(prickle.start_time);
  const endTime = new Date(prickle.end_time);
  const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);

  // Count unique members (attendance table allows multiple records per member for leave/rejoin)
  const uniqueMembers = new Set(attendanceRecords.map(r => r.member_id || r.members?.id)).size;

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    });
  };

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
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Timezone:</span>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Prickle Info */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
        <h2 className="text-xl font-bold mb-4">Prickle Details</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-slate-600 dark:text-slate-400">Type:</span>
            <p className="font-semibold text-slate-900 dark:text-slate-100">{prickleType?.name || "Unknown"}</p>
          </div>
          <div>
            <span className="text-slate-600 dark:text-slate-400">Host:</span>
            <p className="font-semibold">
              {hostMember ? (
                <>
                  <Link href={`/dashboard/members/${hostMember.id}`} className="text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline">
                    {hostMember.name}
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
          <div>
            <span className="text-slate-600 dark:text-slate-400">Date:</span>
            <p className="font-semibold text-slate-900 dark:text-slate-100">{formatDate(startTime)}</p>
          </div>
          <div>
            <span className="text-slate-600 dark:text-slate-400">Time:</span>
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {formatTime(startTime)} - {formatTime(endTime)}
              <span className="text-slate-500 dark:text-slate-400 ml-2">({durationMinutes} min)</span>
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
              {uniqueMembers} {uniqueMembers === 1 ? "attendee" : "attendees"}
            </p>
          </div>
        </div>
        {prickleType?.description && (
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
            <span className="text-slate-600 dark:text-slate-400 text-sm">Description:</span>
            <p className="text-sm text-slate-700 dark:text-slate-300 mt-1">{prickleType.description}</p>
          </div>
        )}
      </div>

      {/* Attendance List */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-xl font-bold">Attendees ({uniqueMembers})</h2>
          {attendanceRecords.length > uniqueMembers && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {attendanceRecords.length} total records (some members left and rejoined)
            </p>
          )}
        </div>
        {attendanceRecords.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Member
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Join Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Leave Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Duration
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {attendanceRecords.map((record: any) => {
                  const member = record.members;
                  const joinTime = new Date(record.join_time);
                  const leaveTime = new Date(record.leave_time);
                  const attendDuration = Math.round((leaveTime.getTime() - joinTime.getTime()) / 60000);

                  return (
                    <tr key={record.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                      <td className="px-6 py-4">
                        <Link href={`/dashboard/members/${member.id}`} className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline">
                          {member.name}
                        </Link>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {member.email}
                        </div>
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
          </div>
        ) : (
          <div className="p-12 text-center text-slate-500 dark:text-slate-400">
            No attendance records for this prickle
          </div>
        )}
      </div>
    </div>
  );
}
