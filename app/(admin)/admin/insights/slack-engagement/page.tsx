import type { Metadata } from "next"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import SlackEngagementCharts from "./SlackEngagementCharts"
import DateRangeFilter from "../../stats/DateRangeFilter"
import {
  computeDayHourHeatmap,
  computeHeroStats,
  computeChannelEngagement,
  computeArchivalCandidates,
  computeTopEmoji,
  type SlackMessageRow,
  type SlackReactionRow,
  type SlackChannelRow,
  type ChannelActivityRow,
} from "@/lib/slack-engagement-stats"

import { resolveDateRange } from "@/lib/stats-date-range"

export const maxDuration = 60

export const metadata: Metadata = {
  title: "Slack Engagement",
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

function formatDateLabel(dateStr: string, style: "long" | "short" = "long"): string {
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-US", {
    month: style === "long" ? "long" : "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

async function fetchAllMessages(
  supabase: SupabaseClient,
  since: string,
  until: string
): Promise<SlackMessageRow[]> {
  const rows: SlackMessageRow[] = []
  let offset = 0
  const BATCH = 1000
  let hasMore = true
  while (hasMore) {
    const { data: batch } = await supabase
      .schema("bronze")
      .from("slack_messages")
      .select("channel_id, channel_name, occurred_at, deleted_at, user_id, thread_ts")
      .gte("occurred_at", since)
      .lte("occurred_at", until)
      .is("deleted_at", null)
      .order("occurred_at")
      .range(offset, offset + BATCH - 1)
    if (batch && batch.length > 0) {
      rows.push(...(batch as unknown as SlackMessageRow[]))
      offset += batch.length
      hasMore = batch.length === BATCH
    } else {
      hasMore = false
    }
  }
  return rows
}

async function fetchAllReactions(
  supabase: SupabaseClient,
  since: string,
  until: string
): Promise<SlackReactionRow[]> {
  const rows: SlackReactionRow[] = []
  let offset = 0
  const BATCH = 1000
  let hasMore = true
  while (hasMore) {
    const { data: batch } = await supabase
      .schema("bronze")
      .from("slack_reactions")
      .select("channel_id, channel_name, occurred_at, removed_at, user_id, reaction")
      .gte("occurred_at", since)
      .lte("occurred_at", until)
      .is("removed_at", null)
      .order("occurred_at")
      .range(offset, offset + BATCH - 1)
    if (batch && batch.length > 0) {
      rows.push(...(batch as unknown as SlackReactionRow[]))
      offset += batch.length
      hasMore = batch.length === BATCH
    } else {
      hasMore = false
    }
  }
  return rows
}

async function fetchAllTimeMessageActivity(supabase: SupabaseClient): Promise<ChannelActivityRow[]> {
  const rows: ChannelActivityRow[] = []
  let offset = 0
  const BATCH = 1000
  let hasMore = true
  while (hasMore) {
    const { data: batch } = await supabase
      .schema("bronze")
      .from("slack_messages")
      .select("channel_id, occurred_at")
      .is("deleted_at", null)
      .order("occurred_at")
      .range(offset, offset + BATCH - 1)
    if (batch && batch.length > 0) {
      rows.push(...(batch as unknown as ChannelActivityRow[]))
      offset += batch.length
      hasMore = batch.length === BATCH
    } else {
      hasMore = false
    }
  }
  return rows
}

function StatCard({
  emoji,
  value,
  label,
  sub,
}: {
  emoji: string
  value: string
  label: string
  sub?: string
}) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 text-center">
      <div className="text-3xl mb-2">{emoji}</div>
      <div className="text-4xl font-bold text-blue-600 dark:text-blue-400 tabular-nums">{value}</div>
      <div className="text-sm font-medium text-slate-700 dark:text-slate-300 mt-1">{label}</div>
      {sub && <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function formatHour(h: number): string {
  if (h === 0) return "12a"
  if (h < 12) return `${h}a`
  if (h === 12) return "12p"
  return `${h - 12}p`
}

export default async function SlackEngagementPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { from: fromParam, to: toParam } = await searchParams
  const { from, to, since, until } = resolveDateRange({ from: fromParam, to: toParam })

  const todayDate = new Date().toISOString().slice(0, 10)
  const fromLabel = formatDateLabel(from, "long")
  const toLabel = to === todayDate ? "today" : formatDateLabel(to, "long")
  const sinceLabel = formatDateLabel(from, "short")

  const [messages, reactions, { data: channelRows }, allTimeActivity] = await Promise.all([
    fetchAllMessages(supabase, since, until),
    fetchAllReactions(supabase, since, until),
    supabase
      .schema("bronze")
      .from("slack_channels")
      .select("channel_id, name, is_archived, is_private, member_count, created"),
    fetchAllTimeMessageActivity(supabase),
  ])

  const channels = (channelRows ?? []) as unknown as SlackChannelRow[]

  const hero = computeHeroStats(messages, reactions)
  const heatmap = computeDayHourHeatmap(messages, reactions)
  const channelEngagement = computeChannelEngagement(messages, reactions, channels, since, until)
  const archivalCandidates = computeArchivalCandidates(allTimeActivity, channels, new Date())
  const topEmoji = computeTopEmoji(reactions)

  return (
    <div className="container mx-auto px-6 py-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-1">Slack Engagement</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
          Quill &amp; Cup · {fromLabel} – {toLabel}
        </p>
        <DateRangeFilter from={from} to={to} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          emoji="💬"
          value={hero.totalMessages.toLocaleString()}
          label="messages"
          sub={`across ${hero.activeChannels} channels`}
        />
        <StatCard
          emoji="😄"
          value={hero.totalReactions.toLocaleString()}
          label="reactions"
        />
        <StatCard
          emoji="👥"
          value={hero.activeUsers.toLocaleString()}
          label="people posted or reacted"
        />
        <StatCard
          emoji="🧵"
          value={`${hero.threadReplyPct}%`}
          label="of messages were thread replies"
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard emoji="📅" value={hero.busiestDay} label="busiest day (ET)" />
        <StatCard emoji="🕐" value={formatHour(hero.busiestHour)} label="busiest hour (ET)" />
        <StatCard
          emoji="🗄️"
          value={archivalCandidates.length.toLocaleString()}
          label="dormant channels"
          sub="60+ days without activity"
        />
        <StatCard
          emoji="🏆"
          value={channelEngagement[0] ? `#${channelEngagement[0].name}` : "—"}
          label="most active channel"
        />
      </div>

      <SlackEngagementCharts
        heatmap={heatmap}
        channels={channelEngagement}
        archivalCandidates={archivalCandidates}
        topEmoji={topEmoji}
        sinceLabel={sinceLabel}
      />
    </div>
  )
}
