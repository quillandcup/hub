"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "UTC", label: "UTC" },
];

interface MemberDetailsProps {
  member: any;
  attendanceRecords: any[];
}

export default function MemberDetails({ member, attendanceRecords }: MemberDetailsProps) {
  const [timezone, setTimezone] = useState("America/New_York");
  const router = useRouter();

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
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const memberMetrics = member.member_metrics || {};
  const memberEngagement = member.member_engagement || {};

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

      {/* Member Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">Status</h3>
          <p className="mt-2">
            <StatusBadge status={member.status} />
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">Last Attended</h3>
          <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
            {memberMetrics.last_attended_at
              ? new Date(memberMetrics.last_attended_at).toLocaleDateString()
              : "Never"}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">Total Prickles</h3>
          <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
            {memberMetrics.total_prickles || 0}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">Last 30 Days</h3>
          <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
            {memberMetrics.prickles_last_30_days || 0}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">Engagement Score</h3>
          <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
            {memberMetrics.engagement_score || 0}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">Risk Level</h3>
          <p className="mt-2">
            <RiskBadge risk={memberEngagement.risk_level || "low"} />
          </p>
        </div>
      </div>

      {/* Attendance History */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-xl font-bold">Attendance History ({attendanceRecords.length})</h2>
        </div>
        {attendanceRecords.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Prickle Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Duration
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Host
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {attendanceRecords.map((record: any) => {
                  const prickle = record.prickles;
                  const joinTime = new Date(record.join_time);
                  const leaveTime = new Date(record.leave_time);
                  const durationMinutes = Math.round((leaveTime.getTime() - joinTime.getTime()) / 60000);

                  return (
                    <tr
                      key={record.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      onClick={() => router.push(`/dashboard/prickles/${prickle.id}`)}
                    >
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {prickle.prickle_types?.name || "Unknown"}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                        {formatDate(joinTime)}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                        {formatTime(joinTime)} - {formatTime(leaveTime)}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                        {durationMinutes} min
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                        {prickle.host ? (
                          prickle.host.id === member.id ? (
                            // They hosted this - show name with star, not clickable
                            <span>{prickle.host.name} ⭐</span>
                          ) : (
                            // Someone else hosted - make it clickable
                            <Link href={`/dashboard/members/${prickle.host.id}`} className="text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline">
                              {prickle.host.name}
                            </Link>
                          )
                        ) : (
                          "None"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center text-slate-500 dark:text-slate-400">
            No attendance records for this member
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors = {
    active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
    inactive: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
    on_hiatus: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  };

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${colors[status as keyof typeof colors] || colors.active}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function RiskBadge({ risk }: { risk: string }) {
  const colors = {
    high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
    medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
    low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  };

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${colors[risk as keyof typeof colors] || colors.low}`}>
      {risk}
    </span>
  );
}
