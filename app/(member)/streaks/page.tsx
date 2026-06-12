import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { getEffectiveIdentity } from "@/lib/sudo"
import { getUserTimezonePreference } from "@/lib/timezone"
import {
  computeStreaks,
  computePrickleStreaks,
  computeSisterStreaks,
  type PrickleStreak,
  type SisterStreak,
} from "@/lib/streaks"

const ORG_TIMEZONE = "America/New_York"

function formatHour(hour: number): string {
  if (hour === 0) return '12am'
  if (hour < 12) return `${hour}am`
  if (hour === 12) return '12pm'
  return `${hour - 12}pm`
}

function formatPrickleLabel(typeName: string, dayOfWeek: string, startHour: number): string {
  return `${typeName} · ${dayOfWeek}s · ${formatHour(startHour)}`
}

function StreakBadge({ current, longest }: { current: number; longest: number }) {
  return (
    <div className="flex items-center gap-6">
      <div className="text-center">
        <p className="text-3xl font-bold">{current}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {current === 1 ? "week" : "weeks"} current
        </p>
      </div>
      <div className="text-center">
        <p className="text-3xl font-bold text-slate-400 dark:text-slate-500">{longest}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {longest === 1 ? "week" : "weeks"} best
        </p>
      </div>
    </div>
  )
}

function StreakRow({
  label,
  current,
  longest,
}: {
  label: string
  current: number
  longest: number
}) {
  const isActive = current > 0
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <span
        className={`text-sm font-medium ${isActive ? "" : "text-slate-500 dark:text-slate-400"}`}
      >
        {isActive && <span className="mr-1.5">🔥</span>}
        {label}
      </span>
      <div className="flex items-center gap-6 text-right flex-shrink-0 ml-4">
        <div className="w-16">
          <p className="text-sm font-bold">{current}w</p>
          <p className="text-xs text-slate-400">current</p>
        </div>
        <div className="w-16">
          <p className="text-sm font-bold text-slate-400 dark:text-slate-500">{longest}w</p>
          <p className="text-xs text-slate-400">best</p>
        </div>
      </div>
    </div>
  )
}

type PrickleInfo = { startTime: string; typeName: string }

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

function SisterStreakRow({
  s,
  prickleMap,
  slackDmUrl,
}: {
  s: SisterStreak
  prickleMap: Map<string, PrickleInfo>
  slackDmUrl?: string
}) {
  const isActive = s.currentStreak > 0
  const sharedPrickles = s.sharedPrickleIds
    .map((id) => ({ id, ...prickleMap.get(id) }))
    .filter((p): p is { id: string; startTime: string; typeName: string } => !!p.startTime)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())

  return (
    <div className="py-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`text-sm font-medium ${isActive ? "" : "text-slate-500 dark:text-slate-400"}`}
          >
            {isActive && <span className="mr-1.5">🔥</span>}
            {s.memberName}
          </span>
          {slackDmUrl && (
            <Link
              href={slackDmUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-slate-400 hover:text-[#4A154B] dark:hover:text-purple-400 flex-shrink-0"
              title={`Message ${s.memberName} on Slack`}
            >
              Message on Slack →
            </Link>
          )}
        </div>
        <div className="flex items-center gap-6 text-right flex-shrink-0 ml-4">
          <div className="w-16">
            <p className="text-sm font-bold">{s.currentStreak}w</p>
            <p className="text-xs text-slate-400">current</p>
          </div>
          <div className="w-16">
            <p className="text-sm font-bold text-slate-400 dark:text-slate-500">
              {s.longestStreak}w
            </p>
            <p className="text-xs text-slate-400">best</p>
          </div>
        </div>
      </div>
      {sharedPrickles.length > 0 && (
        <details className="mt-1.5">
          <summary className="text-xs text-slate-400 cursor-pointer select-none hover:text-slate-600 dark:hover:text-slate-300 w-fit">
            {sharedPrickles.length} shared {sharedPrickles.length === 1 ? "prickle" : "prickles"}
          </summary>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {sharedPrickles.map((p) => (
              <Link
                key={p.id}
                href={`/prickles/${p.id}`}
                className="text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded px-2 py-0.5 text-slate-600 dark:text-slate-300"
              >
                {formatShortDate(p.startTime)} · {p.typeName}
              </Link>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

export default async function StreaksPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const [effectiveIdentity, tzPref] = await Promise.all([
    getEffectiveIdentity(user),
    getUserTimezonePreference(),
  ])
  if (!effectiveIdentity) redirect("/admin")

  const memberId = effectiveIdentity.memberId
  const timeZone = tzPref === "browser" ? ORG_TIMEZONE : tzPref

  // Paginate all of this member's attendance with prickle type info
  const BATCH_SIZE = 1000
  type MyRecord = {
    prickle_id: string
    join_time: string
    prickles: { start_time: string; prickle_types: { name: string } | null } | null
  }
  let myAttendance: MyRecord[] = []
  {
    let offset = 0
    let hasMore = true
    while (hasMore) {
      const { data: batch } = await supabase
        .from("prickle_attendance")
        .select("prickle_id, join_time, prickles(start_time, prickle_types(name))")
        .eq("member_id", memberId)
        .range(offset, offset + BATCH_SIZE - 1)
      if (batch && batch.length > 0) {
        myAttendance = myAttendance.concat(batch as unknown as MyRecord[])
        offset += batch.length
        hasMore = batch.length === BATCH_SIZE
      } else {
        hasMore = false
      }
    }
  }

  // Overall streaks
  const overall = computeStreaks(myAttendance.map((r) => r.join_time))

  // Prickle type streaks
  const prickleStreaks: PrickleStreak[] = computePrickleStreaks(
    myAttendance
      .filter((r) => r.prickles?.prickle_types?.name && r.prickles?.start_time)
      .map((r) => ({
        prickleTypeName: r.prickles!.prickle_types!.name,
        joinTime: r.join_time,
        prickleStartTime: r.prickles!.start_time,
      })),
    new Date(),
    timeZone
  )
    .filter((s) => s.longestStreak >= 2)
    .sort((a, b) => b.currentStreak - a.currentStreak || b.longestStreak - a.longestStreak)

  // Sister streaks — fetch co-attendance in batches of 100 prickle IDs
  const myPrickleIds = [...new Set(myAttendance.map((r) => r.prickle_id))]
  type CoRecord = {
    member_id: string
    prickle_id: string
    join_time: string
    members: { name: string } | null
  }
  let coAttendance: CoRecord[] = []
  const PRICKLE_BATCH = 100
  for (let i = 0; i < myPrickleIds.length; i += PRICKLE_BATCH) {
    const prickleBatch = myPrickleIds.slice(i, i + PRICKLE_BATCH)
    let offset = 0
    let hasMore = true
    while (hasMore) {
      const { data: batch } = await supabase
        .from("prickle_attendance")
        .select("member_id, prickle_id, join_time, members(name)")
        .in("prickle_id", prickleBatch)
        .neq("member_id", memberId)
        .range(offset, offset + BATCH_SIZE - 1)
      if (batch && batch.length > 0) {
        coAttendance = coAttendance.concat(batch as unknown as CoRecord[])
        offset += batch.length
        hasMore = batch.length === BATCH_SIZE
      } else {
        hasMore = false
      }
    }
  }

  const sisterStreaks: SisterStreak[] = computeSisterStreaks(
    myAttendance.map((r) => ({ prickleId: r.prickle_id, joinTime: r.join_time })),
    coAttendance.map((r) => ({
      memberId: r.member_id,
      memberName: r.members?.name ?? "Unknown",
      prickleId: r.prickle_id,
      joinTime: r.join_time,
    }))
  )
    .filter((s) => s.longestStreak >= 2)
    .sort((a, b) => b.currentStreak - a.currentStreak || b.longestStreak - a.longestStreak)
    .slice(0, 20)

  // Look up Slack user IDs: prefer confirmed alias, fall back to email match
  // TODO: proactively send a Slack bot DM when a sister streak is at risk (no shared prickle yet this week)
  const sisterMemberIds = sisterStreaks.map((s) => s.memberId)
  const slackDmByMemberId = new Map<string, string>()
  if (sisterMemberIds.length > 0) {
    const [{ data: slackAliases }, { data: sisterMembers }] = await Promise.all([
      supabase
        .from("member_name_aliases")
        .select("member_id, alias")
        .in("member_id", sisterMemberIds)
        .eq("source", "slack"),
      supabase
        .from("members")
        .select("id, email")
        .in("id", sisterMemberIds),
    ])
    for (const a of slackAliases ?? []) {
      slackDmByMemberId.set(a.member_id, `https://slack.com/app_redirect?channel=${a.alias}`)
    }
    const unmatchedIds = sisterMemberIds.filter((id) => !slackDmByMemberId.has(id))
    if (unmatchedIds.length > 0) {
      const emailByMemberId = new Map((sisterMembers ?? []).map((m) => [m.id, m.email]))
      const emails = unmatchedIds.map((id) => emailByMemberId.get(id)).filter((e): e is string => !!e)
      if (emails.length > 0) {
        const { data: slackUsers } = await supabase
          .schema("bronze")
          .from("slack_users")
          .select("user_id, email")
          .in("email", emails)
        const memberIdByEmail = new Map(
          (sisterMembers ?? []).map((m) => [m.email, m.id])
        )
        for (const u of slackUsers ?? []) {
          const mid = u.email ? memberIdByEmail.get(u.email) : undefined
          if (mid) slackDmByMemberId.set(mid, `https://slack.com/app_redirect?channel=${u.user_id}`)
        }
      }
    }
  }

  // Map prickle_id → display info for shared prickle links
  const prickleMap = new Map<string, PrickleInfo>()
  for (const r of myAttendance) {
    if (r.prickles?.start_time && !prickleMap.has(r.prickle_id)) {
      prickleMap.set(r.prickle_id, {
        startTime: r.prickles.start_time,
        typeName: r.prickles.prickle_types?.name ?? "Prickle",
      })
    }
  }

  return (
    <div className="container mx-auto px-6 py-8 max-w-2xl">
      <h1 className="text-3xl font-bold mb-8">Streaks</h1>

      {/* Overall attendance streak */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
        <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
          Your Attendance Streak
        </h2>
        <div className="flex items-center gap-3">
          {overall.currentStreak > 0 && (
            <span className="text-4xl" aria-hidden>
              🔥
            </span>
          )}
          <StreakBadge current={overall.currentStreak} longest={overall.longestStreak} />
        </div>
        {overall.currentStreak === 0 && overall.longestStreak > 0 && (
          <p className="text-xs text-slate-400 mt-3">
            Attend a prickle this week or next to start a new streak.
          </p>
        )}
      </div>

      {/* Sister streaks */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
        <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
          Sister Streaks
        </h2>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
          Members you&apos;ve shown up to the same prickle with, week after week.
        </p>
        {sisterStreaks.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No sister streaks yet. Consistent co-attendance with another member over 2+ consecutive
            weeks will show up here.
          </p>
        ) : (
          <div>
            {sisterStreaks.map((s) => (
              <SisterStreakRow
                key={s.memberId}
                s={s}
                prickleMap={prickleMap}
                slackDmUrl={slackDmByMemberId.get(s.memberId)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Prickle streaks */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6">
        <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
          Prickle Streaks
        </h2>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
          Your consistency attending the same recurring prickle.
        </p>
        {prickleStreaks.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No prickle streaks yet. Attend the same prickle for 2+ consecutive weeks to start one.
          </p>
        ) : (
          <div>
            {prickleStreaks.map((s) => (
              <StreakRow
                key={`${s.prickleTypeName}|${s.dayOfWeek}|${s.startHour}`}
                label={formatPrickleLabel(s.prickleTypeName, s.dayOfWeek, s.startHour)}
                current={s.currentStreak}
                longest={s.longestStreak}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
