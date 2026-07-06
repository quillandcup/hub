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

function clockFill(pct: number): string {
  if (pct >= 90) return "#1e3a8a" // blue-900
  if (pct >= 75) return "#1d4ed8" // blue-700
  if (pct >= 50) return "#3b82f6" // blue-500
  if (pct >= 25) return "#93c5fd" // blue-300
  if (pct > 0)   return "#dbeafe" // blue-100
  return "#f0f4f8"
}

function ClockHeatmap({ hourCoverage }: { hourCoverage: HourEntry[] }) {
  const size = 300
  const cx = size / 2
  const cy = size / 2
  // Outer ring = AM (0–11), inner ring = PM (12–23)
  const amOuter = 116, amInner = 72
  const pmOuter = 68, pmInner = 28
  const labelR = 132

  function polar(r: number, deg: number) {
    const rad = ((deg - 90) * Math.PI) / 180
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
  }

  function wedge(slot: number, innerR: number, outerR: number): string {
    const gap = 1.5
    const a1 = (slot / 12) * 360 + gap / 2
    const a2 = ((slot + 1) / 12) * 360 - gap / 2
    const p1 = polar(outerR, a1), p2 = polar(outerR, a2)
    const p3 = polar(innerR, a2), p4 = polar(innerR, a1)
    return `M ${p1.x} ${p1.y} A ${outerR} ${outerR} 0 0 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${innerR} ${innerR} 0 0 0 ${p4.x} ${p4.y} Z`
  }

  const cardinals = [
    { slot: 0, label: "12" },
    { slot: 3, label: "3" },
    { slot: 6, label: "6" },
    { slot: 9, label: "9" },
  ]

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Ring backgrounds */}
        <circle cx={cx} cy={cy} r={amOuter + 1} fill="currentColor" className="text-slate-100 dark:text-slate-800" />
        <circle cx={cx} cy={cy} r={amInner - 3} fill="currentColor" className="text-white dark:text-slate-900" />
        <circle cx={cx} cy={cy} r={pmOuter} fill="currentColor" className="text-slate-100 dark:text-slate-800" />
        <circle cx={cx} cy={cy} r={pmInner - 2} fill="currentColor" className="text-white dark:text-slate-900" />

        {/* AM wedges — outer ring */}
        {hourCoverage.filter(e => e.hour < 12).map(({ hour, pct }) => (
          <path key={hour} d={wedge(hour, amInner, amOuter)} fill={clockFill(pct)}>
            <title>{formatHour(hour)}: {pct}%</title>
          </path>
        ))}

        {/* PM wedges — inner ring */}
        {hourCoverage.filter(e => e.hour >= 12).map(({ hour, pct }) => (
          <path key={hour} d={wedge(hour - 12, pmInner, pmOuter)} fill={clockFill(pct)}>
            <title>{formatHour(hour)}: {pct}%</title>
          </path>
        ))}

        {/* Cardinal tick marks + hour labels */}
        {cardinals.map(({ slot, label }) => {
          const angle = (slot / 12) * 360
          const t1 = polar(amOuter + 1, angle), t2 = polar(amOuter + 8, angle)
          const lp = polar(labelR, angle)
          return (
            <g key={slot}>
              <line x1={t1.x} y1={t1.y} x2={t2.x} y2={t2.y} stroke="currentColor" strokeWidth={1.5} className="text-slate-400 dark:text-slate-500" />
              <text x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight="600" fill="currentColor" className="text-slate-500 dark:text-slate-400">{label}</text>
            </g>
          )
        })}
      </svg>
      <p className="text-[10px] text-slate-400 dark:text-slate-500">outer ring = AM · inner ring = PM</p>
    </div>
  )
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
          subtitle="Average members per session (min 3 sessions)"
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

      {/* Hour of Day clock heatmap */}
      <ChartCard
        title="🕐 Writing Throughout the Day (ET)"
        subtitle="% of days since Jan 1 with at least one attended prickle at each hour"
      >
        <ClockHeatmap hourCoverage={hourCoverage} />
        <div className="flex items-center justify-center gap-2 mt-2 text-xs text-slate-400 dark:text-slate-500">
          <span>Less</span>
          {["#f0f4f8", "#dbeafe", "#93c5fd", "#3b82f6", "#1d4ed8", "#1e3a8a"].map((c) => (
            <div key={c} className="w-4 h-4 rounded border border-slate-200 dark:border-slate-700" style={{ backgroundColor: c }} />
          ))}
          <span>More</span>
        </div>
      </ChartCard>
    </div>
  )
}
