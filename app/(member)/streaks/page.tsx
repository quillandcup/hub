import type { Metadata } from "next"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { getEffectiveIdentity } from "@/lib/sudo"
import { getUserTimezonePreference } from "@/lib/timezone"
import { getMemberDisplayName } from "@/lib/member-display-name"
import MemberHoverCard from "@/components/member/MemberHoverCard"

export const metadata: Metadata = {
  title: "Streaks",
}
import {
  computeStreaks,
  computePrickleStreaks,
  computeSisterStreaks,
  rankStreaks,
  type PrickleStreak,
  type SisterStreak,
} from "@/lib/streaks"
import { ORG_TIMEZONE } from "@/lib/config";

const STREAK_LIST_LIMIT = 10

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
    <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <span
        className={`text-sm font-medium truncate ${isActive ? "" : "text-slate-500 dark:text-slate-400"}`}
      >
        {isActive && <span className="mr-1.5">🔥</span>}
        {label}
      </span>
      <div className="flex items-center gap-4 text-right flex-shrink-0 ml-4">
        <div className="w-12">
          <p className="text-sm font-bold">{current}w</p>
          <p className="text-[10px] text-slate-400 leading-tight">current</p>
        </div>
        <div className="w-12">
          <p className="text-sm font-bold text-slate-400 dark:text-slate-500">{longest}w</p>
          <p className="text-[10px] text-slate-400 leading-tight">best</p>
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
  photoUrl,
}: {
  s: SisterStreak
  prickleMap: Map<string, PrickleInfo>
  photoUrl: string | null
}) {
  const isActive = s.currentStreak > 0
  const sharedPrickles = s.sharedPrickleIds
    .map((id) => ({ id, ...prickleMap.get(id) }))
    .filter((p): p is { id: string; startTime: string; typeName: string } => !!p.startTime)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())

  return (
    <div className="py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {/* Fixed-width flame slot (empty when extinguished) keeps every avatar in one column. */}
          <span aria-hidden="true" className="w-5 flex-shrink-0 text-center text-sm">
            {isActive && "🔥"}
          </span>
          {/* 24px fits the row, which the stats on the right already make about 32px tall. */}
          <MemberHoverCard
            memberId={s.memberId}
            name={s.memberName}
            photoUrl={photoUrl}
            avatarSize={24}
            surface="streaks"
            trackName="streaks-open-member"
            nameClassName={`text-sm font-medium ${isActive ? "" : "text-slate-500 dark:text-slate-400"}`}
          />
        </div>
        <div className="flex items-center gap-4 text-right flex-shrink-0 ml-4">
          <div className="w-12">
            <p className="text-sm font-bold">{s.currentStreak}w</p>
            <p className="text-[10px] text-slate-400 leading-tight">current</p>
          </div>
          <div className="w-12">
            <p className="text-sm font-bold text-slate-400 dark:text-slate-500">
              {s.longestStreak}w
            </p>
            <p className="text-[10px] text-slate-400 leading-tight">best</p>
          </div>
        </div>
      </div>
      {sharedPrickles.length > 0 && (
        <details className="mt-1">
          <summary className="text-xs text-slate-400 cursor-pointer select-none hover:text-slate-600 dark:hover:text-slate-300 w-fit">
            {sharedPrickles.length} shared {sharedPrickles.length === 1 ? "Prickle" : "Prickles"}
          </summary>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {sharedPrickles.map((p) => (
              <Link data-track="streaks-open-prickle"
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
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  const [effectiveIdentity, tzPref] = await Promise.all([getEffectiveIdentity(user), getUserTimezonePreference()])
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
  const overall = computeStreaks(myAttendance.map((r) => r.join_time), new Date(), timeZone)

  // Prickle type streaks
  const rankedPrickleStreaks: PrickleStreak[] = computePrickleStreaks(
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
  const { items: prickleStreaks, total: totalPrickleStreaks } = rankStreaks(
    rankedPrickleStreaks,
    STREAK_LIST_LIMIT
  )

  // Sister streaks — fetch co-attendance in batches of 100 prickle IDs
  const myPrickleIds = [...new Set(myAttendance.map((r) => r.prickle_id))]
  type CoRecord = {
    member_id: string
    prickle_id: string
    join_time: string
    members: { name: string; display_name: string | null } | null
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
        .select("member_id, prickle_id, join_time, members:attendance_member(name, display_name)")
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

  const rankedSisterStreaks: SisterStreak[] = computeSisterStreaks(
    myAttendance.map((r) => ({ prickleId: r.prickle_id, joinTime: r.join_time })),
    coAttendance.map((r) => ({
      memberId: r.member_id,
      memberName: r.members ? getMemberDisplayName(r.members) : "Unknown",
      prickleId: r.prickle_id,
      joinTime: r.join_time,
    })),
    new Date(),
    timeZone
  )
  const { items: sisterStreaks, total: totalSisterStreaks } = rankStreaks(
    rankedSisterStreaks,
    STREAK_LIST_LIMIT
  )

  // TODO: proactively send a Slack bot DM when a sister streak is at risk (no shared prickle yet this week)
  // Photos come from the member directory (public fields), one query for the (at most 10) rows.
  // The Message button lives in the hover card on each name, which resolves the Slack link itself.
  const sisterIds = sisterStreaks.map((s) => s.memberId)
  const photoRows =
    sisterIds.length > 0
      ? await supabase.from("member_directory").select("id, photo_url").in("id", sisterIds).then((r) => r.data ?? [])
      : ([] as { id: string; photo_url: string | null }[])
  const photoByMemberId = new Map(photoRows.map((r) => [r.id, r.photo_url]))

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
    <div className="container mx-auto px-6 py-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-4">Streaks</h1>

      {/* Overall attendance streak */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4 mb-4">
        <h2 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
          Your Attendance Streak
        </h2>
        <div className="flex items-center gap-3">
          {overall.currentStreak > 0 && (
            <span className="text-3xl" aria-hidden>
              🔥
            </span>
          )}
          <StreakBadge current={overall.currentStreak} longest={overall.longestStreak} />
        </div>
        {overall.currentStreak === 0 && overall.longestStreak > 0 && (
          <p className="text-xs text-slate-400 mt-2">
            Attend a Prickle this week or next to start a new streak.
          </p>
        )}
      </div>

      <div className="@container">
        <div className="grid grid-cols-1 @pair:grid-cols-2 gap-4">
        {/* Prickle streaks */}
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4">
          <h2 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
            Prickle Streaks
          </h2>
          {prickleStreaks.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              No Prickle streaks yet. Attend the same Prickle for 2+ consecutive weeks to start one.
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
              {totalPrickleStreaks > prickleStreaks.length && (
                <p className="text-xs text-slate-400 mt-2">
                  Top {prickleStreaks.length} of {totalPrickleStreaks}.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Sister streaks */}
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4">
          <h2 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
            Sister Streaks
          </h2>
          {sisterStreaks.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              No sister streaks yet. Consistent co-attendance with another member over 2+
              consecutive weeks will show up here.
            </p>
          ) : (
            <div>
              {sisterStreaks.map((s) => (
                <SisterStreakRow
                  key={s.memberId}
                  s={s}
                  prickleMap={prickleMap}
                  photoUrl={photoByMemberId.get(s.memberId) ?? null}
                />
              ))}
              {totalSisterStreaks > sisterStreaks.length && (
                <p className="text-xs text-slate-400 mt-2">
                  Top {sisterStreaks.length} of {totalSisterStreaks}.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}
