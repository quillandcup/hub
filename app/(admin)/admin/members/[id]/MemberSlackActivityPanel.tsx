"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useServerDataTable } from "@/lib/hooks/useDataTable";
import { DEFAULT_SLACK_SORT, SLACK_SORT_COLUMNS, type SlackKindFilter, type SlackSortColumn } from "@/lib/slack-activity-table";
import type { SlackSummary } from "@/lib/data/activities";
import { slackEmojiToUnicode, formatSlackPermalink } from "@/lib/slack-emoji";
import ReactionEmoji from "@/components/ReactionEmoji";
import type { ReactionEmojiValue } from "@/lib/slack-reaction-emoji";
import { SortableTh } from "@/components/SortableTh";
import { DataTablePager } from "@/components/DataTablePager";

export interface SlackPageData {
  rows: any[];
  total: number;
  page: number;
  pageSize: number;
  kind: SlackKindFilter;
  channel: string | null;
  /** Every channel the member has Slack activity in, busiest first. */
  channels: { name: string; count: number }[];
}

interface MemberSlackActivityPanelProps {
  slackPage: SlackPageData;
  /** Totals over all of the member's Slack activity. */
  slackSummary: SlackSummary;
}

// TODO: move to env variable
const SLACK_WORKSPACE_URL = "https://quillandcup.slack.com";

export default function MemberSlackActivityPanel({ slackPage, slackSummary }: MemberSlackActivityPanelProps) {
  const { rows: slackActivities, kind: slackActivityFilter, channel: slackChannelFilter, channels } = slackPage;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // A new filter starts on page 1; sort and page size carry over.
  function setParam(name: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(name, value);
    else params.delete(name);
    params.delete("page");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }
  const setSlackActivityFilter = (kind: SlackKindFilter) => setParam("type", kind === "all" ? null : kind);
  const setSlackChannelFilter = (channel: string | null) => setParam("channel", channel);
  const table = useServerDataTable<any, SlackSortColumn>({
    rows: slackActivities,
    total: slackPage.total,
    page: slackPage.page,
    pageSize: slackPage.pageSize,
    allowed: SLACK_SORT_COLUMNS,
    defaultSort: DEFAULT_SLACK_SORT,
  });
  const { sortColumn, sortDirection, handleSort } = table;

  const slackStats = {
    totalMessages: slackSummary.messages,
    totalReactions: slackSummary.reactions,
    channels,
    last30Days: slackSummary.last30Days,
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Slack Activity</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setSlackActivityFilter("all")}
              className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                slackActivityFilter === "all"
                  ? "bg-plum-100 dark:bg-plum-900 text-plum-900 dark:text-plum-100"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setSlackActivityFilter("messages")}
              className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                slackActivityFilter === "messages"
                  ? "bg-plum-100 dark:bg-plum-900 text-plum-900 dark:text-plum-100"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              Messages
            </button>
            <button
              onClick={() => setSlackActivityFilter("reactions")}
              className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                slackActivityFilter === "reactions"
                  ? "bg-plum-100 dark:bg-plum-900 text-plum-900 dark:text-plum-100"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              Reactions
            </button>
          </div>
        </div>
      </div>
      {slackSummary.total > 0 ? (
        <div className="p-6">
          {/* Slack Stats Grid */}
          <div className="@container">
            <div className="grid grid-cols-2 @cards:grid-cols-4 gap-4 mb-6">
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
                {slackSummary.channels}
              </div>
            </div>
          </div>
          </div>

          {/* Channel Participation */}
          {slackStats.channels.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                Active Channels
                {slackChannelFilter && (
                  <button
                    onClick={() => setSlackChannelFilter(null)}
                    className="ml-2 text-xs text-plum-600 dark:text-plum-400 hover:underline"
                  >
                    (clear filter)
                  </button>
                )}
              </h3>
              <div className="flex flex-wrap gap-2">
                {slackStats.channels.slice(0, 10).map(({ name: channel }) => (
                  <button
                    key={channel}
                    onClick={() => setSlackChannelFilter(channel === slackChannelFilter ? null : channel)}
                    className={`px-3 py-1 rounded-full text-sm border transition-colors cursor-pointer ${
                      slackChannelFilter === channel
                        ? "bg-plum-200 dark:bg-plum-800 text-plum-900 dark:text-plum-100 border-plum-400 dark:border-plum-600"
                        : "bg-plum-50 dark:bg-plum-900/20 text-plum-700 dark:text-plum-300 border-plum-200 dark:border-plum-800 hover:bg-plum-100 dark:hover:bg-plum-900/40"
                    }`}
                  >
                    #{channel}
                  </button>
                ))}
                {slackStats.channels.length > 10 && (
                  <span className="px-3 py-1 text-slate-600 dark:text-slate-400 text-sm">
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
                    <SortableTh
                      label="Type"
                      className="px-6 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider"
                      active={sortColumn === "type"}
                      direction={sortDirection}
                      onClick={() => handleSort("type")}
                    />
                    <SortableTh
                      label="Channel"
                      className="px-6 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider"
                      active={sortColumn === "channel"}
                      direction={sortDirection}
                      onClick={() => handleSort("channel")}
                    />
                    <SortableTh
                      label="Content"
                      className="px-6 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider"
                      active={sortColumn === "content"}
                      direction={sortDirection}
                      onClick={() => handleSort("content")}
                    />
                    <SortableTh
                      label="Date"
                      className="px-6 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider"
                      active={sortColumn === "date"}
                      direction={sortDirection}
                      onClick={() => handleSort("date")}
                    />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {table.rows
                    .map((activity: any) => {
                    const occurred = new Date(activity.occurred_at);
                    const isMessage = activity.activity_type === 'slack_message' || activity.activity_type === 'slack_thread_reply';
                    const isThreadReply = activity.activity_type === 'slack_thread_reply';
                    const isReaction = activity.activity_type === 'slack_reaction';

                    // Extract reaction emoji from activity data and convert to Unicode
                    const reactionShortcode = isReaction
                      ? (activity.data?.reaction || activity.title?.match(/:([^:]+):/)?.[1] || 'thumbsup')
                      : null;
                    // The server resolves custom images and the full standard set (data.reaction_emoji);
                    // the small static map only covers rows it couldn't.
                    const staticEmoji = reactionShortcode ? slackEmojiToUnicode(reactionShortcode) : null;
                    const reactionEmoji: ReactionEmojiValue | null =
                      activity.data?.reaction_emoji ??
                      (staticEmoji && !(staticEmoji.startsWith(':') && staticEmoji.endsWith(':')) ? { text: staticEmoji } : null);

                    // Build Slack permalink
                    const slackUrl = activity.data?.channel_id && activity.data?.message_ts
                      ? formatSlackPermalink(
                          SLACK_WORKSPACE_URL,
                          activity.data.channel_id,
                          activity.data.message_ts
                        )
                      : null;

                    const rowContent = (
                      <>
                        <td className="px-6 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {isMessage ? (
                              <>
                                <svg className="w-4 h-4 text-plum-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                </svg>
                                <span className="text-xs text-slate-600 dark:text-slate-400">
                                  {isThreadReply ? 'Reply' : 'Message'}
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="text-base">
                                  <ReactionEmoji name={reactionShortcode} emoji={reactionEmoji} />
                                </span>
                                <span className="text-xs text-slate-600 dark:text-slate-400">
                                  Reaction
                                </span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-3 whitespace-nowrap">
                          <span className="text-xs text-slate-600 dark:text-slate-400">
                            #{activity.data?.channel_name || 'unknown'}
                          </span>
                        </td>
                        <td className="px-6 py-3">
                          <p className="text-sm text-slate-700 dark:text-slate-300 truncate max-w-md">
                            {activity.description || (isReaction ? <>Reacted with <ReactionEmoji name={reactionShortcode} emoji={reactionEmoji} /></> : '—')}
                          </p>
                        </td>
                        <td className="px-6 py-3 whitespace-nowrap">
                          <div className="text-xs text-slate-600 dark:text-slate-400">
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
            <DataTablePager table={table} itemLabel="activities" />
          </div>
        </div>
      ) : (
        <div className="p-12 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 mb-4">
            <svg className="w-8 h-8 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <p className="text-slate-600 dark:text-slate-400 font-medium mb-1">
            No Slack Activity
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            This member hasn't posted messages or reactions in Slack yet
          </p>
        </div>
      )}
    </div>
  );
}
