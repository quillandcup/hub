import { createClient } from "@/lib/supabase/server"
import { redirect, notFound } from "next/navigation"
import { getEffectiveIdentity } from "@/lib/sudo"
import { computeStreaks } from "@/lib/streaks"

export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const supabase = await createClient()
  const { id } = await params

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const effectiveIdentity = await getEffectiveIdentity(user)
  if (!effectiveIdentity) redirect("/admin")

  const isSelf = effectiveIdentity.memberId === id

  const { data: member } = await supabase
    .from("members")
    .select("id, name, email, joined_at, status")
    .eq("id", id)
    .single()

  if (!member) notFound()

  let metrics: {
    member_id: string
    last_attended_at: string | null
    sessions_last_7_days: number
    sessions_last_30_days: number
    total_sessions: number
    engagement_score: number
    updated_at: string
  } | null = null
  let attendance: {
    id: string
    join_time: string
    leave_time: string
    prickles: { start_time: string; prickle_types: { name: string } | null } | null
  }[] = []
  let streakJoinTimes: string[] = []

  if (isSelf) {
    // Fetch metrics and history concurrently (both bounded queries)
    const [{ data: metricsData }, { data: historyData }] = await Promise.all([
      supabase.from("member_metrics").select("*").eq("member_id", id).single(),
      supabase
        .from("prickle_attendance")
        .select("id, join_time, leave_time, prickles(start_time, prickle_types(name))")
        .eq("member_id", id)
        .order("join_time", { ascending: false })
        .limit(50),
    ])
    metrics = metricsData
    attendance = (historyData ?? []) as unknown as typeof attendance

    // Paginate all join_times for streak computation (sequential by nature)
    const BATCH_SIZE = 1000
    let offset = 0
    let hasMore = true
    while (hasMore) {
      const { data: batch } = await supabase
        .from("prickle_attendance")
        .select("join_time")
        .eq("member_id", id)
        .range(offset, offset + BATCH_SIZE - 1)
      if (batch && batch.length > 0) {
        streakJoinTimes = streakJoinTimes.concat(batch.map((r) => r.join_time))
        offset += batch.length
        hasMore = batch.length === BATCH_SIZE
      } else {
        hasMore = false
      }
    }
  }

  const streaks = computeStreaks(streakJoinTimes)

  const joinedYear = new Date(member.joined_at).getFullYear()
  const joinedMonth = new Date(member.joined_at).toLocaleString("en-US", { month: "long" })

  const statusColors: Record<string, string> = {
    active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    on_hiatus: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    inactive: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  }
  const statusLabel: Record<string, string> = {
    active: "Active",
    on_hiatus: "On Hiatus",
    inactive: "Inactive",
  }

  return (
    <div className="container mx-auto px-6 py-8 max-w-2xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold">{member.name}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Member since {joinedMonth} {joinedYear}
        </p>
      </div>

      {/* Tier 3: visible to all */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
        <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
          Community Stats
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-3xl font-bold">{metrics?.total_sessions ?? 0}</span>
          <span className="text-slate-500 dark:text-slate-400">prickles attended</span>
        </div>
      </div>

      {/* Tier 2: self only */}
      {isSelf && (
        <>
          {/* Account info */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
            <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
              Account
            </h2>
            <div className="space-y-3">
              <div>
                <span className="text-xs text-slate-500 dark:text-slate-400">Email</span>
                <p className="text-sm font-medium">{member.email}</p>
              </div>
              <div>
                <span className="text-xs text-slate-500 dark:text-slate-400">Status</span>
                <div className="mt-1">
                  <span
                    className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                      statusColors[member.status] ?? statusColors.inactive
                    }`}
                  >
                    {statusLabel[member.status] ?? member.status}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Engagement metrics */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
            <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
              Engagement
            </h2>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="text-center">
                <p className="text-2xl font-bold">{metrics?.sessions_last_7_days ?? 0}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Last 7 days</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">{metrics?.sessions_last_30_days ?? 0}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Last 30 days</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">{metrics?.total_sessions ?? 0}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">All time</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-slate-100 dark:border-slate-800 pt-4">
              <div className="text-center">
                <p className="text-2xl font-bold">{streaks.currentStreak}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {streaks.currentStreak === 1 ? "week" : "weeks"} current streak
                </p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">{streaks.longestStreak}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {streaks.longestStreak === 1 ? "week" : "weeks"} best streak
                </p>
              </div>
            </div>
          </div>

          {/* Prickle history */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6">
            <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
              Prickle History{attendance.length === 50 ? " (last 50)" : ""}
            </h2>
            {attendance.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No prickles attended yet.</p>
            ) : (
              <div className="space-y-2">
                {attendance.map((record) => {
                  const joinDate = new Date(record.join_time)
                  const durationMin = Math.round(
                    (new Date(record.leave_time).getTime() - joinDate.getTime()) / 60000
                  )
                  const prickleName = record.prickles?.prickle_types?.name ?? "Prickle"
                  const dateStr = joinDate.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                  return (
                    <div
                      key={record.id}
                      className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800 last:border-0"
                    >
                      <div>
                        <span className="text-sm font-medium">{prickleName}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400 ml-2">{dateStr}</span>
                      </div>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {durationMin} min
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
