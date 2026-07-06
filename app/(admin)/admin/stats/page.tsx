import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import FunStatsCharts from "./FunStatsCharts"
import {
  computeTopHosts,
  computeTopAttendees,
  computePrickleTypes,
  computeHourCoverage,
  computeDayOfWeek,
  computeHeroStats,
  type PrickleRow,
  type AttRow,
} from "@/lib/fun-stats"

export const maxDuration = 60

const SINCE = "2026-01-01T00:00:00Z"

async function fetchAllPrickles(supabase: Awaited<ReturnType<typeof createClient>>, now: string) {
  const rows: PrickleRow[] = []
  let offset = 0
  const BATCH = 1000
  let hasMore = true
  while (hasMore) {
    const { data: batch } = await supabase
      .from("prickles")
      .select("id, start_time, members!host(name), prickle_types(name, normalized_name)")
      .gte("start_time", SINCE)
      .lte("start_time", now)
      .range(offset, offset + BATCH - 1)
    if (batch && batch.length > 0) {
      rows.push(...(batch as unknown as PrickleRow[]))
      offset += batch.length
      hasMore = batch.length === BATCH
    } else {
      hasMore = false
    }
  }
  return rows
}

async function fetchAllAttendance(supabase: Awaited<ReturnType<typeof createClient>>) {
  const rows: AttRow[] = []
  let offset = 0
  const BATCH = 1000
  let hasMore = true
  while (hasMore) {
    const { data: batch } = await supabase
      .from("prickle_attendance")
      .select("member_id, prickle_id, join_time, leave_time, members(name)")
      .gte("join_time", SINCE)
      .range(offset, offset + BATCH - 1)
    if (batch && batch.length > 0) {
      rows.push(...(batch as unknown as AttRow[]))
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

export default async function FunStatsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const now = new Date().toISOString()

  const [prickles, attendance] = await Promise.all([
    fetchAllPrickles(supabase, now),
    fetchAllAttendance(supabase),
  ])

  const attendedPrickleIds = new Set(attendance.map((a) => a.prickle_id))
  const attendedPrickles = prickles.filter((p) => attendedPrickleIds.has(p.id))

  const attendanceByPrickle = new Map<string, number>()
  for (const a of attendance) {
    attendanceByPrickle.set(a.prickle_id, (attendanceByPrickle.get(a.prickle_id) ?? 0) + 1)
  }

  const { totalHours, uniqueAttendees, weekdayCoverage } = computeHeroStats(
    attendedPrickles,
    attendance
  )

  return (
    <div className="container mx-auto px-6 py-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-1">Community Stats</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm">
          Quill &amp; Cup · January 1, 2026 – today
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          emoji="✍️"
          value={attendedPrickles.length.toLocaleString()}
          label="prickles held"
          sub="with at least one attendee"
        />
        <StatCard
          emoji="⏱️"
          value={totalHours.toLocaleString()}
          label="hours written together"
          sub="across all members"
        />
        <StatCard
          emoji="👥"
          value={uniqueAttendees.toLocaleString()}
          label="members showed up"
          sub="at least once"
        />
        <StatCard
          emoji="☕"
          value={`${weekdayCoverage}%`}
          label="of weekdays at 7am"
          sub="someone was always writing"
        />
      </div>

      <FunStatsCharts
        topHosts={computeTopHosts(prickles)}
        topAttendees={computeTopAttendees(attendance)}
        prickleTypes={computePrickleTypes(prickles, attendanceByPrickle)}
        hourCoverage={computeHourCoverage(attendedPrickles)}
        dayOfWeek={computeDayOfWeek(attendedPrickles)}
      />
    </div>
  )
}
