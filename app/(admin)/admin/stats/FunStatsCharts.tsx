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

import type { TopEntry, TypeEntry, HourEntry, DowEntry } from "@/lib/fun-stats"
export type { TopEntry, TypeEntry, HourEntry, DowEntry }

interface Props {
  topHosts: TopEntry[]
  topAttendees: TopEntry[]
  prickleTypes: TypeEntry[]
  hourCoverage: HourEntry[]
  dayOfWeek: DowEntry[]
}

const TOOLTIP_STYLE = {
  backgroundColor: "#1e293b",
  border: "none",
  borderRadius: "8px",
  color: "#fff",
  fontSize: "12px",
}

function heatClass(pct: number): string {
  if (pct >= 90) return "bg-blue-600 text-white"
  if (pct >= 75) return "bg-blue-400 text-white"
  if (pct >= 50) return "bg-blue-200 text-slate-700"
  if (pct >= 25) return "bg-blue-100 text-slate-600"
  if (pct > 0)   return "bg-slate-100 text-slate-400"
  return "bg-slate-50 text-slate-300"
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
      {subtitle && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">{subtitle}</p>
      )}
      {children}
    </div>
  )
}

function HorizontalBars({
  data,
  dataKey,
  color,
  nameKey = "name",
  labelWidth = 130,
  height = 280,
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
          tickFormatter={(v: string) => (v.length > 18 ? v.slice(0, 17) + "…" : v)}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey={dataKey} fill={color} radius={[0, 4, 4, 0]} name={tooltipLabel} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export default function FunStatsCharts({
  topHosts,
  topAttendees,
  prickleTypes,
  hourCoverage,
  dayOfWeek,
}: Props) {
  return (
    <div className="space-y-6">
      {/* Row 1: Top Hosts + Top Attendees */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ChartCard title="🏆 Top Hosts" subtitle="Prickles hosted since Jan 1">
          <HorizontalBars
            data={topHosts}
            dataKey="count"
            color="#3b82f6"
            tooltipLabel="Hosted"
          />
        </ChartCard>

        <ChartCard title="🌟 Most Active Members" subtitle="Unique prickles attended since Jan 1">
          <HorizontalBars
            data={topAttendees}
            dataKey="count"
            color="#8b5cf6"
            tooltipLabel="Prickles Attended"
          />
        </ChartCard>
      </div>

      {/* Row 2: Prickle Types + Day of Week */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ChartCard
          title="📚 Prickle Types by Avg Attendance"
          subtitle="Average members per session (min 5 sessions)"
        >
          <HorizontalBars
            data={prickleTypes}
            dataKey="avgAttendance"
            color="#10b981"
            labelWidth={155}
            height={320}
            tooltipLabel="Avg Attendance"
          />
        </ChartCard>

        <ChartCard title="📅 Writing by Day of Week" subtitle="Attended prickles per day, since Jan 1">
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={dayOfWeek} margin={{ left: 0, right: 10, top: 4, bottom: 4 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="currentColor"
                className="text-slate-200 dark:text-slate-700"
              />
              <XAxis dataKey="day" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Prickles" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Hour of Day heatmap */}
      <ChartCard
        title="🕐 Writing Throughout the Day (ET)"
        subtitle="% of days since Jan 1 with at least one attended prickle at each hour"
      >
        <div className="grid grid-cols-12 gap-1.5 mt-1">
          {hourCoverage.map(({ hour, pct }) => (
            <div
              key={hour}
              className={`rounded-lg flex flex-col items-center justify-center py-2 ${heatClass(pct)}`}
            >
              <span className="text-[10px] font-medium leading-none">{formatHour(hour)}</span>
              <span className="text-[11px] font-bold leading-tight mt-0.5">{pct}%</span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 mt-3 text-xs text-slate-400 dark:text-slate-500">
          <span>Less</span>
          {[0, 10, 30, 60, 80, 95].map((p) => (
            <div key={p} className={`w-4 h-4 rounded ${heatClass(p)}`} />
          ))}
          <span>More</span>
        </div>
      </ChartCard>
    </div>
  )
}
