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
import { SortableTh } from "@/components/SortableTh"
import { useDataTable } from "@/lib/hooks/useDataTable"
import type { SortValue } from "@/lib/hooks/useTableSort"
import { DataTablePager } from "@/components/DataTablePager"

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
  if (pct >= 0.8) return "#613048"
  if (pct >= 0.6) return "#8b3e64"
  if (pct >= 0.4) return "#b65a88"
  if (pct >= 0.2) return "#dca4c0"
  return "#f4e5ed"
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

function Sparkline({ data, color = "#b65a88" }: { data: number[]; color?: string }) {
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

type ChannelSortColumn =
  | "name"
  | "messages"
  | "reactions"
  | "threadReplies"
  | "uniqueUsers"
  | "peak"
  | "lastActivity"

function channelSortValue(c: ChannelEngagement, column: ChannelSortColumn): SortValue {
  switch (column) {
    case "name":
      return c.name.toLowerCase()
    case "peak":
      // Week order (Sun..Sat) then hour.
      return DAY_ORDER.indexOf(c.peakDay) * 24 + c.peakHour
    case "lastActivity":
      return c.lastActivity
    default:
      return c[column]
  }
}

function ChannelBreakdownTable({ channels }: { channels: ChannelEngagement[] }) {
  const table = useDataTable<ChannelEngagement, ChannelSortColumn>({
    rows: channels,
    getSortValue: channelSortValue,
    defaultSort: null,
  })
  const { sortColumn, sortDirection, handleSort } = table

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
            <SortableTh
              label="Channel"
              className="py-2 pr-4"
              active={sortColumn === "name"}
              direction={sortDirection}
              onClick={() => handleSort("name")}
            />
            <SortableTh
              label="Messages"
              align="right"
              className="py-2 pr-4"
              active={sortColumn === "messages"}
              direction={sortDirection}
              onClick={() => handleSort("messages")}
            />
            <SortableTh
              label="Reactions"
              align="right"
              className="py-2 pr-4"
              active={sortColumn === "reactions"}
              direction={sortDirection}
              onClick={() => handleSort("reactions")}
            />
            <SortableTh
              label="Thread Replies"
              align="right"
              className="py-2 pr-4"
              active={sortColumn === "threadReplies"}
              direction={sortDirection}
              onClick={() => handleSort("threadReplies")}
            />
            <SortableTh
              label="Active Users"
              align="right"
              className="py-2 pr-4"
              active={sortColumn === "uniqueUsers"}
              direction={sortDirection}
              onClick={() => handleSort("uniqueUsers")}
            />
            <SortableTh
              label="Peak Time"
              className="py-2 pr-4"
              active={sortColumn === "peak"}
              direction={sortDirection}
              onClick={() => handleSort("peak")}
            />
            <SortableTh
              label="Last Activity"
              className="py-2 pr-4"
              active={sortColumn === "lastActivity"}
              direction={sortDirection}
              onClick={() => handleSort("lastActivity")}
            />
            <th className="py-2 pr-4">Trend</th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((c) => (
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
      <DataTablePager table={table} itemLabel="channels" />
    </div>
  )
}

type ArchivalSortColumn = "name" | "memberCount" | "lastActivity" | "daysSinceActivity" | "totalMessagesAllTime"

function archivalSortValue(c: ArchivalCandidate, column: ArchivalSortColumn): SortValue {
  return column === "name" ? c.name.toLowerCase() : c[column]
}

function ArchivalCandidatesTable({ candidates }: { candidates: ArchivalCandidate[] }) {
  const table = useDataTable<ArchivalCandidate, ArchivalSortColumn>({
    rows: candidates,
    getSortValue: archivalSortValue,
    defaultSort: null,
  })
  const { sortColumn, sortDirection, handleSort } = table

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
            <SortableTh
              label="Channel"
              className="py-2 pr-4"
              active={sortColumn === "name"}
              direction={sortDirection}
              onClick={() => handleSort("name")}
            />
            <SortableTh
              label="Members"
              align="right"
              className="py-2 pr-4"
              active={sortColumn === "memberCount"}
              direction={sortDirection}
              onClick={() => handleSort("memberCount")}
            />
            <SortableTh
              label="Last Activity"
              className="py-2 pr-4"
              active={sortColumn === "lastActivity"}
              direction={sortDirection}
              onClick={() => handleSort("lastActivity")}
            />
            <SortableTh
              label="Days Dormant"
              align="right"
              className="py-2 pr-4"
              active={sortColumn === "daysSinceActivity"}
              direction={sortDirection}
              onClick={() => handleSort("daysSinceActivity")}
            />
            <SortableTh
              label="Messages (all-time)"
              align="right"
              className="py-2 pr-4"
              active={sortColumn === "totalMessagesAllTime"}
              direction={sortDirection}
              onClick={() => handleSort("totalMessagesAllTime")}
            />
          </tr>
        </thead>
        <tbody>
          {table.rows.map((c) => (
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
      <DataTablePager table={table} itemLabel="channels" />
    </div>
  )
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
          {["#f0f4f8", "#f4e5ed", "#dca4c0", "#b65a88", "#8b3e64", "#613048"].map((c) => (
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
            color="#b65a88"
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
        <ChannelBreakdownTable channels={channels} />
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
          <ArchivalCandidatesTable candidates={archivalCandidates} />
        )}
      </ChartCard>
    </div>
  )
}
