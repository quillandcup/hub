"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"

import type {
  HeatCell,
  ChannelEngagement,
  ArchivalCandidate,
  EmojiEntry,
} from "@/lib/slack-engagement-stats"

interface Props {
  heatmap: HeatCell[]
  channels: ChannelEngagement[]
  archivalCandidates: ArchivalCandidate[]
  topEmoji: EmojiEntry[]
  sinceLabel: string
}

const TOOLTIP_STYLE = {
  backgroundColor: "#1e293b",
  border: "none",
  borderRadius: "8px",
  color: "#fff",
  fontSize: "12px",
}

const DAY_ORDER = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function heatColor(count: number, max: number): string {
  if (count === 0) return "#f0f4f8"
  const pct = count / max
  if (pct >= 0.8) return "#1e3a8a"
  if (pct >= 0.6) return "#1d4ed8"
  if (pct >= 0.4) return "#3b82f6"
  if (pct >= 0.2) return "#93c5fd"
  return "#dbeafe"
}

function formatHour(h: number): string {
  if (h === 0) return "12a"
  if (h < 12) return `${h}a`
  if (h === 12) return "12p"
  return `${h - 12}p`
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6">
      <h2 className="text-lg font-bold mb-0.5">{title}</h2>
      {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">{subtitle}</p>}
      {children}
    </div>
  )
}

function DayHourHeatmap({ heatmap }: { heatmap: HeatCell[] }) {
  const max = Math.max(1, ...heatmap.map((c) => c.count))
  const byDay = new Map<string, HeatCell[]>()
  for (const cell of heatmap) {
    const arr = byDay.get(cell.day) ?? []
    arr.push(cell)
    byDay.set(cell.day, arr)
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="grid grid-cols-[3rem_repeat(24,1fr)] gap-[2px] mb-1">
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              className="text-center text-[9px] text-slate-400 dark:text-slate-500"
            >
              {h % 3 === 0 ? formatHour(h) : ""}
            </div>
          ))}
        </div>
        {DAY_ORDER.map((day) => (
          <div key={day} className="grid grid-cols-[3rem_repeat(24,1fr)] gap-[2px] mb-[2px]">
            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center">
              {day}
            </div>
            {(byDay.get(day) ?? []).map((cell) => (
              <div
                key={cell.hour}
                title={`${day} ${formatHour(cell.hour)} ET · ${cell.count} event${cell.count === 1 ? "" : "s"}`}
                aria-label={`${day} ${formatHour(cell.hour)}: ${cell.count} events`}
                className="aspect-square rounded-sm"
                style={{ backgroundColor: heatColor(cell.count, max) }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function HorizontalBars({
  data,
  dataKey,
  color,
  nameKey = "name",
  labelWidth = 140,
  height = 320,
  tooltipLabel,
}: {
  data: object[]
  dataKey: string
  color: string
  nameKey?: string
  labelWidth?: number
  height?: number
  tooltipLabel: string
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart layout="vertical" data={data} margin={{ left: 10, right: 24, top: 4, bottom: 4 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          horizontal={false}
          stroke="currentColor"
          className="text-slate-200 dark:text-slate-700"
        />
        <XAxis type="number" tick={{ fontSize: 11 }} />
        <YAxis
          type="category"
          dataKey={nameKey}
          width={labelWidth}
          tick={{ fontSize: 11 }}
          tickFormatter={(v: string) => (v.length > 20 ? v.slice(0, 19) + "…" : v)}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey={dataKey} fill={color} radius={[0, 4, 4, 0]} name={tooltipLabel} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function Sparkline({ data, color = "#3b82f6" }: { data: number[]; color?: string }) {
  const max = Math.max(1, ...data)
  const w = 100
  const h = 24
  const step = data.length > 1 ? w / (data.length - 1) : w
  const points = data.map((v, i) => `${i * step},${h - (v / max) * (h - 2) - 1}`).join(" ")
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never"
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export default function SlackEngagementCharts({
  heatmap,
  channels,
  archivalCandidates,
  topEmoji,
  sinceLabel,
}: Props) {
  const channelBarData = channels.map((c) => ({
    name: `#${c.name}`,
    engagement: c.messages + c.reactions,
  }))

  return (
    <div className="space-y-6">
      <ChartCard
        title="🕐 When the Community Is Active"
        subtitle={`Messages + reactions by day and hour (ET), since ${sinceLabel}`}
      >
        <DayHourHeatmap heatmap={heatmap} />
        <div className="flex items-center justify-center gap-2 mt-3 text-xs text-slate-400 dark:text-slate-500">
          <span>Less</span>
          {["#f0f4f8", "#dbeafe", "#93c5fd", "#3b82f6", "#1d4ed8", "#1e3a8a"].map((c) => (
            <div
              key={c}
              className="w-4 h-4 rounded border border-slate-200 dark:border-slate-700"
              style={{ backgroundColor: c }}
            />
          ))}
          <span>More</span>
        </div>
      </ChartCard>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ChartCard title="📣 Most Engaged Channels" subtitle={`Messages + reactions since ${sinceLabel}`}>
          <HorizontalBars
            data={channelBarData}
            dataKey="engagement"
            color="#3b82f6"
            tooltipLabel="Engagement"
          />
        </ChartCard>

        <ChartCard title="😄 Top Reactions" subtitle={`Most-used emoji since ${sinceLabel}`}>
          <HorizontalBars
            data={topEmoji.map((e) => ({ name: `:${e.emoji}:`, count: e.count }))}
            dataKey="count"
            color="#f59e0b"
            tooltipLabel="Uses"
            labelWidth={110}
          />
        </ChartCard>
      </div>

      <ChartCard title="📊 Channel Breakdown" subtitle={`Detail since ${sinceLabel}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <th className="py-2 pr-4">Channel</th>
                <th className="py-2 pr-4 text-right">Messages</th>
                <th className="py-2 pr-4 text-right">Reactions</th>
                <th className="py-2 pr-4 text-right">Thread Replies</th>
                <th className="py-2 pr-4 text-right">Active Users</th>
                <th className="py-2 pr-4">Peak Time</th>
                <th className="py-2 pr-4">Last Activity</th>
                <th className="py-2 pr-4">Trend</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr
                  key={c.channelId}
                  className="border-b border-slate-100 dark:border-slate-800/50"
                >
                  <td className="py-2 pr-4 font-medium">
                    {c.isPrivate ? "🔒 " : "#"}
                    {c.name}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{c.messages.toLocaleString()}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{c.reactions.toLocaleString()}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{c.threadReplies.toLocaleString()}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{c.uniqueUsers.toLocaleString()}</td>
                  <td className="py-2 pr-4 text-slate-500 dark:text-slate-400">
                    {c.peakDay} {formatHour(c.peakHour)}
                  </td>
                  <td className="py-2 pr-4 text-slate-500 dark:text-slate-400">
                    {formatDate(c.lastActivity)}
                  </td>
                  <td className="py-2 pr-4">
                    <Sparkline data={c.sparkline} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>

      <ChartCard
        title="🗄️ Archival Candidates"
        subtitle="Non-archived channels with no recent engagement — consider archiving"
      >
        {archivalCandidates.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No dormant channels found — everything's seeing some activity. 🎉
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2 pr-4">Channel</th>
                  <th className="py-2 pr-4 text-right">Members</th>
                  <th className="py-2 pr-4">Last Activity</th>
                  <th className="py-2 pr-4 text-right">Days Dormant</th>
                  <th className="py-2 pr-4 text-right">Messages (all-time)</th>
                </tr>
              </thead>
              <tbody>
                {archivalCandidates.map((c) => (
                  <tr
                    key={c.channelId}
                    className="border-b border-slate-100 dark:border-slate-800/50"
                  >
                    <td className="py-2 pr-4 font-medium">#{c.name}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {c.memberCount?.toLocaleString() ?? "—"}
                    </td>
                    <td className="py-2 pr-4 text-slate-500 dark:text-slate-400">
                      {formatDate(c.lastActivity)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {c.daysSinceActivity ?? "—"}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {c.totalMessagesAllTime.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  )
}
