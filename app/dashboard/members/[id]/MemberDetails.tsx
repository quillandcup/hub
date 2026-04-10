"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AttendanceCalendar from "./AttendanceCalendar";
import { slackEmojiToUnicode, formatSlackPermalink } from "@/lib/slack-emoji";

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
  hiatusHistory: any[];
  slackActivities: any[];
  userTimezonePreference?: string; // User's timezone preference from profile
}

export default function MemberDetails({ member, attendanceRecords, hiatusHistory, slackActivities, userTimezonePreference = "browser" }: MemberDetailsProps) {
  // Detect browser timezone if user preference is "browser"
  const [detectedTimezone, setDetectedTimezone] = useState<string | null>(null);
  useEffect(() => {
    if (userTimezonePreference === "browser") {
      setDetectedTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
  }, [userTimezonePreference]);

  // Use user's preference, or detected timezone, or fallback to ET
  const defaultTimezone =
    userTimezonePreference === "browser"
      ? (detectedTimezone || "America/New_York")
      : userTimezonePreference;

  const [timezone, setTimezone] = useState(defaultTimezone);
  const [view, setView] = useState<"list" | "calendar">("calendar");
  const router = useRouter();

  // Update timezone when defaultTimezone changes (after browser detection)
  useEffect(() => {
    setTimezone(defaultTimezone);
  }, [defaultTimezone]);

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

  // Slack workspace URL - TODO: move to env variable
  const SLACK_WORKSPACE_URL = 'https://quillandcup.slack.com';

  // Calculate Slack statistics
  const slackStats = {
    totalMessages: slackActivities.filter(a => a.activity_type === 'slack_message' || a.activity_type === 'slack_thread_reply').length,
    totalReactions: slackActivities.filter(a => a.activity_type === 'slack_reaction').length,
    channels: [...new Set(slackActivities.map(a => a.metadata?.channel_name).filter(Boolean))],
    last30Days: slackActivities.filter(a => {
      const occurred = new Date(a.occurred_at);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return occurred >= thirtyDaysAgo;
    }).length,
    lastActivity: slackActivities.length > 0 ? new Date(slackActivities[0].occurred_at) : null,
  };

  // Calculate current hiatus progress if on hiatus
  const currentHiatus = hiatusHistory.find(h => h.end_date === null);
  let hiatusProgress = null;
  if (currentHiatus) {
    const startDate = new Date(currentHiatus.start_date);
    const now = new Date();
    const daysSinceStart = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const monthsSinceStart = daysSinceStart / 30; // Rough estimate

    // Only show progress after at least 1 month (30 days)
    if (daysSinceStart >= 30) {
      if (monthsSinceStart < 6) {
        hiatusProgress = "25%";
      } else if (monthsSinceStart < 9) {
        hiatusProgress = "50%";
      } else if (monthsSinceStart < 12) {
        hiatusProgress = "75%";
      } else {
        hiatusProgress = "90%+";
      }
    }
  }

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

        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">Last Slack Activity</h3>
          {slackActivities.length > 0 ? (
            <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
              {slackStats.lastActivity
                ? slackStats.lastActivity.toLocaleDateString()
                : "Never"}
            </p>
          ) : (
            <div className="mt-2 flex items-center gap-2">
              <span className="px-2 py-1 text-xs font-medium rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                No Activity
              </span>
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
          <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">Slack (30d)</h3>
          {slackActivities.length > 0 ? (
            <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
              {slackStats.last30Days}
            </p>
          ) : (
            <div className="mt-2 flex items-center gap-2">
              <span className="px-2 py-1 text-xs font-medium rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                No Activity
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Slack Activity */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-xl font-bold">Slack Activity</h2>
        </div>
        {slackActivities.length > 0 ? (
          <div className="p-6">
            {/* Slack Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4">
                <div className="text-sm font-medium text-slate-600 dark:text-slate-400">Messages</div>
                <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {slackStats.totalMessages}
                </div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4">
                <div className="text-sm font-medium text-slate-600 dark:text-slate-400">Reactions</div>
                <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {slackStats.totalReactions}
                </div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4">
                <div className="text-sm font-medium text-slate-600 dark:text-slate-400">Last 30 Days</div>
                <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {slackStats.last30Days}
                </div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4">
                <div className="text-sm font-medium text-slate-600 dark:text-slate-400">Channels</div>
                <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {slackStats.channels.length}
                </div>
              </div>
            </div>

            {/* Channel Participation */}
            {slackStats.channels.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Active Channels</h3>
                <div className="flex flex-wrap gap-2">
                  {slackStats.channels.slice(0, 10).map((channel: string) => (
                    <span
                      key={channel}
                      className="px-3 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-full text-sm border border-blue-200 dark:border-blue-800"
                    >
                      #{channel}
                    </span>
                  ))}
                  {slackStats.channels.length > 10 && (
                    <span className="px-3 py-1 text-slate-500 dark:text-slate-400 text-sm">
                      +{slackStats.channels.length - 10} more
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Recent Activity */}
            <div>
              <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Recent Activity</h3>
              <div className="overflow-x-auto -mx-6">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-800 border-y border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="px-6 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-6 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Channel
                      </th>
                      <th className="px-6 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Content
                      </th>
                      <th className="px-6 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Date
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {slackActivities.slice(0, 20).map((activity: any) => {
                      const occurred = new Date(activity.occurred_at);
                      const isMessage = activity.activity_type === 'slack_message' || activity.activity_type === 'slack_thread_reply';
                      const isThreadReply = activity.activity_type === 'slack_thread_reply';
                      const isReaction = activity.activity_type === 'slack_reaction';

                      // Extract reaction emoji from metadata and convert to Unicode
                      const reactionShortcode = isReaction
                        ? (activity.metadata?.reaction || activity.title?.match(/:([^:]+):/)?.[1] || 'thumbsup')
                        : null;
                      const reactionEmojiUnicode = reactionShortcode ? slackEmojiToUnicode(reactionShortcode) : null;
                      // If emoji conversion returned shortcode (not found), show as badge instead
                      const isCustomEmoji = reactionEmojiUnicode?.startsWith(':') && reactionEmojiUnicode?.endsWith(':');
                      const reactionDisplay = isCustomEmoji
                        ? reactionShortcode // Show just the name without colons for custom emojis
                        : reactionEmojiUnicode;

                      // Build Slack permalink
                      const slackUrl = activity.metadata?.channel_id && activity.metadata?.message_ts
                        ? formatSlackPermalink(
                            SLACK_WORKSPACE_URL,
                            activity.metadata.channel_id,
                            activity.metadata.message_ts
                          )
                        : null;

                      const rowContent = (
                        <>
                          <td className="px-6 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              {isMessage ? (
                                <>
                                  <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                  </svg>
                                  <span className="text-xs text-slate-600 dark:text-slate-400">
                                    {isThreadReply ? 'Reply' : 'Message'}
                                  </span>
                                </>
                              ) : isCustomEmoji ? (
                                <>
                                  <span className="px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded text-xs font-medium border border-yellow-200 dark:border-yellow-800">
                                    :{reactionDisplay}:
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className="text-base">{reactionDisplay}</span>
                                  <span className="text-xs text-slate-600 dark:text-slate-400">
                                    Reaction
                                  </span>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-3 whitespace-nowrap">
                            <span className="text-xs text-slate-600 dark:text-slate-400">
                              #{activity.metadata?.channel_name || 'unknown'}
                            </span>
                          </td>
                          <td className="px-6 py-3">
                            <p className="text-sm text-slate-700 dark:text-slate-300 truncate max-w-md">
                              {activity.description || (isReaction ? (isCustomEmoji ? `Reacted with :${reactionDisplay}:` : `Reacted with ${reactionDisplay}`) : '—')}
                            </p>
                          </td>
                          <td className="px-6 py-3 whitespace-nowrap">
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {occurred.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                              <span className="ml-1">
                                {occurred.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                              </span>
                            </div>
                          </td>
                        </>
                      );

                      return slackUrl ? (
                        <tr
                          key={activity.id}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                          onClick={() => window.open(slackUrl, '_blank')}
                        >
                          {rowContent}
                        </tr>
                      ) : (
                        <tr key={activity.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                          {rowContent}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {slackActivities.length > 20 && (
                <div className="mt-3 text-center">
                  <button className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:underline">
                    Show all {slackActivities.length} activities
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-12 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 mb-4">
              <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-slate-600 dark:text-slate-400 font-medium mb-1">
              No Slack Activity
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-500">
              This member hasn't posted messages or reactions in Slack yet
            </p>
          </div>
        )}
      </div>

      {/* Hiatus History */}
      {hiatusHistory.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-xl font-bold">Hiatus History</h2>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              {hiatusHistory.map((hiatus: any, idx: number) => {
                const startDate = new Date(hiatus.start_date);
                const endDate = hiatus.end_date ? new Date(hiatus.end_date) : null;
                const isOngoing = !endDate;

                let durationText = "";
                if (endDate) {
                  const durationDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                  const durationMonths = Math.floor(durationDays / 30);
                  if (durationMonths > 0) {
                    durationText = `${durationMonths} month${durationMonths > 1 ? 's' : ''}`;
                  } else {
                    durationText = `${durationDays} day${durationDays > 1 ? 's' : ''}`;
                  }
                } else {
                  const daysSoFar = Math.floor((new Date().getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                  const monthsSoFar = Math.floor(daysSoFar / 30);
                  if (monthsSoFar > 0) {
                    durationText = `${monthsSoFar} month${monthsSoFar > 1 ? 's' : ''} so far`;
                  } else {
                    durationText = `${daysSoFar} day${daysSoFar > 1 ? 's' : ''} so far`;
                  }
                }

                return (
                  <div
                    key={hiatus.id}
                    className={`p-4 rounded-lg border ${
                      isOngoing
                        ? "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800"
                        : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                            {startDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            {" → "}
                            {endDate ? (
                              <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100 font-semibold">
                                {endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                              </span>
                            ) : (
                              "Ongoing"
                            )}
                          </span>
                          {isOngoing && hiatusProgress && (
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-200 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100">
                              {hiatusProgress}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-slate-600 dark:text-slate-400">
                          Duration: {durationText}
                        </div>
                        {hiatus.reason && (
                          <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                            {hiatus.reason}
                          </div>
                        )}
                      </div>
                      {isOngoing && (
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300">
                          Current
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Attendance History */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Attendance History ({attendanceRecords.length})</h2>

            {/* View Tabs */}
            <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
              <button
                onClick={() => setView("list")}
                className={`
                  px-4 py-1.5 text-sm font-medium rounded-md transition-colors
                  ${view === "list"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                  }
                `}
              >
                List
              </button>
              <button
                onClick={() => setView("calendar")}
                className={`
                  px-4 py-1.5 text-sm font-medium rounded-md transition-colors
                  ${view === "calendar"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                  }
                `}
              >
                Calendar
              </button>
            </div>
          </div>
        </div>

        {attendanceRecords.length > 0 ? (
          <div className="p-6">
            {view === "list" ? (
              <div className="overflow-x-auto -mx-6">
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
                              {prickle.host?.id === member.id && "⭐ "}
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
                              <Link
                                href={`/dashboard/members/${prickle.host.id}`}
                                className="text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {prickle.host.name}
                              </Link>
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
              <AttendanceCalendar
                member={member}
                attendanceRecords={attendanceRecords}
                timezone={timezone}
                formatTime={formatTime}
                formatDate={formatDate}
              />
            )}
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
