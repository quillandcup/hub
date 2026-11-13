import type { Metadata } from "next"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "@/lib/auth"
import { redirect } from "next/navigation"
import SlackEngagementCharts from "./SlackEngagementCharts"
import DateRangeFilter from "../../stats/DateRangeFilter"
import {
  computeDayHourHeatmap,
  computeHeroStats,
  computeChannelEngagement,
  computeArchivalCandidates,
  computeTopEmoji,
  qualifyByWorkspace,
  type SlackMessageRow,
  type SlackReactionRow,
  type SlackChannelRow,
  type ChannelActivityRow,
} from "@/lib/slack-engagement-stats"

import { resolveDateRange } from "@/lib/stats-date-range"
import { createRepos } from "@/lib/data/repos"
import { requireStaffPage } from "@/lib/admin-auth"
import Link from "next/link"

export const maxDuration = 60

export const metadata: Metadata = {
  title: "Slack Engagement",
}

function formatDateLabel(dateStr: string, style: "long" | "short" = "long"): string {
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-US", {
    month: style === "long" ? "long" : "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
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
      <div className="text-4xl font-bold text-plum-600 dark:text-plum-400 tabular-nums">{value}</div>
      <div className="text-sm font-medium text-slate-700 dark:text-slate-300 mt-1">{label}</div>
      {sub && <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{sub}</div>}
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
  searchParams: Promise<{ from?: string; to?: string; workspace?: string }>
}) {
  await requireStaffPage()
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  const { from: fromParam, to: toParam, workspace: workspaceParam } = await searchParams
  const { from, to, since, until } = resolveDateRange({ from: fromParam, to: toParam })

  const todayDate = new Date().toISOString().slice(0, 10)
  const fromLabel = formatDateLabel(from, "long")
  const toLabel = to === todayDate ? "today" : formatDateLabel(to, "long")
  const sinceLabel = formatDateLabel(from, "short")

  // Engagement is combined across Slack workspaces unless one is chosen. The choice is in the URL as the Slack team id
  // ("primary" while the original workspace has none recorded), never a Hub id.
  const workspaces = await createRepos(supabase).slackWorkspaces.list()
  const keyOf = (w: (typeof workspaces)[number]) => w.team_id ?? "primary"
  const chosen = workspaceParam ? workspaces.find((w) => keyOf(w) === workspaceParam) : undefined
  const repos = createRepos(supabase, chosen ? { slackWorkspaceId: chosen.id } : {})
  const mixed = !chosen && workspaces.length > 1
  const workspaceNames = new Map(workspaces.map((w) => [w.id, w.name]))
  const [rawMessages, rawReactions, rawChannels, rawActivity] = await Promise.all([
    repos.slackMessages.liveMessagesBetween(since, until),
    repos.slackMessages.liveReactionsBetween(since, until),
    repos.slackWorkspace.channels(),
    repos.slackMessages.liveMessageTimes(),
  ])
  const messages = mixed ? qualifyByWorkspace(rawMessages, workspaceNames, "channel_name") : rawMessages
  const reactions = mixed ? qualifyByWorkspace(rawReactions, workspaceNames, "channel_name") : rawReactions
  const channelRows = mixed ? qualifyByWorkspace(rawChannels, workspaceNames, "name") : rawChannels
  const allTimeActivity = mixed ? qualifyByWorkspace(rawActivity, workspaceNames) : rawActivity

  // Group DMs and 1:1 DMs count toward the totals, but they aren't channels: keep them (and
  // their names, which list the members) out of the per-channel tables.
  const allConversations = channelRows as unknown as (SlackChannelRow & { is_mpim: boolean; is_im: boolean })[]
  const groupDmIds = new Set(allConversations.filter((c) => c.is_mpim || c.is_im).map((c) => c.channel_id))
  const channels: SlackChannelRow[] = allConversations.filter((c) => !c.is_mpim && !c.is_im)
  const channelMessages = messages.filter((m) => !groupDmIds.has(m.channel_id))
  const channelReactions = reactions.filter((r) => !groupDmIds.has(r.channel_id))

  const hero = computeHeroStats(messages, reactions)
  const heatmap = computeDayHourHeatmap(messages, reactions)
  const channelEngagement = computeChannelEngagement(channelMessages, channelReactions, channels, since, until)
  const archivalCandidates = computeArchivalCandidates(
    allTimeActivity.filter((a) => !groupDmIds.has(a.channel_id)),
    channels,
    new Date()
  )
  const topEmoji = computeTopEmoji(reactions)

  return (
    <div className="container mx-auto px-6 py-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-1">Slack Engagement</h1>
        <p className="text-slate-600 dark:text-slate-400 text-sm mb-4">
          Quill &amp; Cup · {chosen ? chosen.name : workspaces.length > 1 ? "All workspaces" : "Slack"} · {fromLabel} – {toLabel}
        </p>
        {workspaces.length > 1 && (
          <nav aria-label="Slack workspace" className="flex flex-wrap gap-2 mb-4 text-sm">
            {[{ key: "", label: "All workspaces" }, ...workspaces.map((w) => ({ key: keyOf(w), label: w.name }))].map(({ key, label }) => {
              const query = new URLSearchParams({ from, to, ...(key ? { workspace: key } : {}) })
              const active = key === (chosen ? keyOf(chosen) : "")
              return (
                <Link
                  key={key || "all"}
                  href={`/admin/insights/slack-engagement?${query}`}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full border px-3 py-1 ${active ? "bg-plum-600 text-white border-plum-600" : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"}`}
                >
                  {label}
                </Link>
              )
            })}
          </nav>
        )}
        <DateRangeFilter from={from} to={to} keep={chosen ? { workspace: keyOf(chosen) } : undefined} />
      </div>

      <div className="@container">
        <div className="grid grid-cols-2 @cards:grid-cols-4 gap-4 mb-8">
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
      </div>

      <div className="@container">
        <div className="grid grid-cols-2 @cards:grid-cols-4 gap-4 mb-8">
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
