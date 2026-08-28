import type { Metadata } from "next"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { getEffectiveIdentity } from "@/lib/sudo"
import { getUserTimezonePreference } from "@/lib/timezone"
import { computeSisterStreaks, rankStreaks, type SisterStreak } from "@/lib/streaks"
import { buildAttendanceMap, getScheduleSlot } from "@/lib/scheduled-prickle-stats"

export const metadata: Metadata = {
  title: "Network",
}

const ORG_TIMEZONE = "America/New_York"
const BATCH_SIZE = 1000
const PRICKLE_BATCH = 100
const NETWORK_LIMIT = 12

async function fetchAllPaginated<T>(
  queryFn: (offset: number) => PromiseLike<{ data: T[] | null }>
): Promise<T[]> {
  let all: T[] = []
  let offset = 0
  let hasMore = true
  while (hasMore) {
    const { data } = await queryFn(offset)
    if (data && data.length > 0) {
      all = all.concat(data)
      offset += data.length
      hasMore = data.length === BATCH_SIZE
    } else {
      hasMore = false
    }
  }
  return all
}

// ---------------------------------------------------------------------------
// Avatar (self-contained — no client component needed, matches
// app/(member)/members/[id]/MemberAvatar.tsx's initials/color logic, but
// renders the photo as a CSS background instead of an <img> so we don't need
// an onError handler / "use client" just for a broken-image fallback).
// ---------------------------------------------------------------------------

function getInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return "?"
  const parts = trimmed.split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return trimmed.slice(0, 2).toUpperCase()
}

function getAvatarColor(name: string): string {
  const colors = ["bg-violet-500", "bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-cyan-500"]
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

function AvatarCircle({
  name,
  photoUrl,
  size,
  ring = false,
}: {
  name: string
  photoUrl?: string | null
  size: number
  ring?: boolean
}) {
  return (
    <div
      className={`rounded-full flex items-center justify-center flex-shrink-0 text-white font-semibold bg-cover bg-center shadow-sm ${getAvatarColor(name)} ${
        ring ? "ring-4 ring-blue-500/30 dark:ring-blue-400/40" : ""
      }`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        backgroundImage: photoUrl ? `url(${photoUrl})` : undefined,
      }}
    >
      {!photoUrl && getInitials(name)}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Radial network visualization
// ---------------------------------------------------------------------------

function nodeSize(longestStreak: number): number {
  return Math.round(Math.min(84, 48 + longestStreak * 4))
}

function lineWidth(currentStreak: number): number {
  return Math.min(3, 0.8 + currentStreak * 0.35)
}

interface PositionedConnection extends SisterStreak {
  x: number
  y: number
  size: number
  photoUrl: string | null
}

export default async function NetworkPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const effectiveIdentity = await getEffectiveIdentity(user)
  if (!effectiveIdentity) redirect("/admin")

  const memberId = effectiveIdentity.memberId
  const memberName = effectiveIdentity.memberName

  const [tzPref, { data: selfRow }] = await Promise.all([
    getUserTimezonePreference(),
    supabase.from("members").select("photo_url").eq("id", memberId).single(),
  ])
  const timeZone = tzPref === "browser" ? ORG_TIMEZONE : tzPref
  const memberPhotoUrl: string | null = selfRow?.photo_url ?? null

  // Paginate all of this member's attendance (see CLAUDE.md pagination rule).
  type MyRecord = { prickle_id: string; join_time: string }
  const myAttendance = await fetchAllPaginated<MyRecord>((offset) =>
    supabase
      .from("prickle_attendance")
      .select("prickle_id, join_time")
      .eq("member_id", memberId)
      .range(offset, offset + BATCH_SIZE - 1)
  )

  // Co-attendance, batched by prickle ID — same pattern as app/(member)/streaks/page.tsx.
  const myPrickleIds = [...new Set(myAttendance.map((r) => r.prickle_id))]
  type CoRecord = { member_id: string; prickle_id: string; join_time: string; members: { name: string } | null }
  let coAttendance: CoRecord[] = []
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

  const rankedSisterStreaks = computeSisterStreaks(
    myAttendance.map((r) => ({ prickleId: r.prickle_id, joinTime: r.join_time })),
    coAttendance.map((r) => ({
      memberId: r.member_id,
      memberName: r.members?.name ?? "Unknown",
      prickleId: r.prickle_id,
      joinTime: r.join_time,
    })),
    new Date(),
    timeZone
  )
  const { items: connections, total: totalConnections } = rankStreaks(rankedSisterStreaks, NETWORK_LIMIT)

  const hasConnections = connections.length > 0

  // Photos for connection nodes (only needed when we have connections to draw).
  const photoByMemberId = new Map<string, string>()
  if (hasConnections) {
    const { data: photoRows } = await supabase
      .from("members")
      .select("id, photo_url")
      .in("id", connections.map((c) => c.memberId))
    for (const row of photoRows ?? []) {
      if (row.photo_url) photoByMemberId.set(row.id, row.photo_url)
    }
  }

  // ---------------------------------------------------------------------
  // Empty-state suggestions (only computed when there's nothing to draw).
  // ---------------------------------------------------------------------
  let hasPostedInSlack = true
  let slackStartHereUrl: string | null = null
  let prickleSuggestions: { typeName: string; slotLabel: string; avgAttendance: number }[] = []
  let wellConnected: { id: string; name: string; photoUrl: string | null }[] = []

  if (!hasConnections) {
    const now = new Date()

    const [slackActivityResult, startHereChannelResult] = await Promise.all([
      supabase
        .from("member_activities")
        .select("member_id")
        .eq("member_id", memberId)
        .eq("source", "slack")
        .limit(1)
        .maybeSingle(),
      supabase.schema("bronze").from("slack_channels").select("channel_id").ilike("name", "start-here").limit(1).maybeSingle(),
    ])
    hasPostedInSlack = !!slackActivityResult.data
    if (startHereChannelResult.data?.channel_id) {
      slackStartHereUrl = `https://quillandcup.slack.com/app_redirect?channel=${startHereChannelResult.data.channel_id}`
    }

    // Prickle times to join: reuse buildAttendanceMap/getScheduleSlot from
    // lib/scheduled-prickle-stats.ts rather than building new aggregation logic.
    const upcomingEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
    const historyStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)

    type UpcomingRow = { id: string; start_time: string; prickle_types: { name: string } | null }
    type HistoricalRow = { id: string; start_time: string }

    let upcomingPrickles: UpcomingRow[] = []
    {
      let offset = 0
      let hasMore = true
      while (hasMore) {
        const { data: batch } = await supabase
          .from("prickles")
          .select("id, start_time, prickle_types(name)")
          .gte("start_time", now.toISOString())
          .lte("start_time", upcomingEnd.toISOString())
          .order("start_time")
          .range(offset, offset + BATCH_SIZE - 1)
        if (batch && batch.length > 0) {
          upcomingPrickles = upcomingPrickles.concat(batch as unknown as UpcomingRow[])
          offset += batch.length
          hasMore = batch.length === BATCH_SIZE
        } else {
          hasMore = false
        }
      }
    }

    const historicalPrickles = await fetchAllPaginated<HistoricalRow>((offset) =>
      supabase
        .from("prickles")
        .select("id, start_time")
        .gte("start_time", historyStart.toISOString())
        .lt("start_time", now.toISOString())
        .range(offset, offset + BATCH_SIZE - 1)
    )

    const historicalIds = historicalPrickles.map((p) => p.id)
    let historicalAttendance: { prickle_id: string; member_id: string }[] = []
    for (let i = 0; i < historicalIds.length; i += 500) {
      const idsChunk = historicalIds.slice(i, i + 500)
      if (idsChunk.length === 0) continue
      const rows = await fetchAllPaginated<{ prickle_id: string; member_id: string }>((offset) =>
        supabase
          .from("prickle_attendance")
          .select("prickle_id, member_id")
          .in("prickle_id", idsChunk)
          .range(offset, offset + BATCH_SIZE - 1)
      )
      historicalAttendance = historicalAttendance.concat(rows)
    }
    const attendanceMap = buildAttendanceMap(historicalAttendance)

    const slotCounts = new Map<string, number[]>()
    for (const p of historicalPrickles) {
      const slot = getScheduleSlot(p.start_time)
      const count = attendanceMap.get(p.id)?.size ?? 0
      if (!slotCounts.has(slot.sortKey)) slotCounts.set(slot.sortKey, [])
      slotCounts.get(slot.sortKey)!.push(count)
    }
    const avgBySlot = new Map<string, number>()
    for (const [key, counts] of slotCounts) {
      avgBySlot.set(key, counts.reduce((a, b) => a + b, 0) / counts.length)
    }

    const upcomingBySlot = new Map<string, { typeName: string; slotLabel: string; avgAttendance: number }>()
    for (const p of upcomingPrickles) {
      const slot = getScheduleSlot(p.start_time)
      if (upcomingBySlot.has(slot.sortKey)) continue // upcomingPrickles is ordered by start_time, keep earliest
      upcomingBySlot.set(slot.sortKey, {
        typeName: p.prickle_types?.name ?? "Prickle",
        slotLabel: slot.label,
        avgAttendance: avgBySlot.get(slot.sortKey) ?? 0,
      })
    }
    prickleSuggestions = [...upcomingBySlot.values()]
      .sort((a, b) => b.avgAttendance - a.avgAttendance)
      .slice(0, 3)

    // Well-connected hedgies: rank by distinct co-attended prickles over a
    // trailing window as a lightweight proxy — not a full recommendation engine.
    const wellConnectedStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    const recentAttendance = await fetchAllPaginated<{ member_id: string; prickle_id: string }>((offset) =>
      supabase
        .from("prickle_attendance")
        .select("member_id, prickle_id")
        .gte("join_time", wellConnectedStart.toISOString())
        .neq("member_id", memberId)
        .range(offset, offset + BATCH_SIZE - 1)
    )
    const prickleSetByMember = new Map<string, Set<string>>()
    for (const r of recentAttendance) {
      if (!prickleSetByMember.has(r.member_id)) prickleSetByMember.set(r.member_id, new Set())
      prickleSetByMember.get(r.member_id)!.add(r.prickle_id)
    }
    const topMemberIds = [...prickleSetByMember.entries()]
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, 4)
      .map(([id]) => id)

    if (topMemberIds.length > 0) {
      const { data: topMemberRows } = await supabase
        .from("members")
        .select("id, name, photo_url")
        .in("id", topMemberIds)
      const byId = new Map((topMemberRows ?? []).map((m) => [m.id, m]))
      wellConnected = topMemberIds
        .map((id) => byId.get(id))
        .filter((m): m is { id: string; name: string; photo_url: string | null } => !!m)
        .map((m) => ({ id: m.id, name: m.name, photoUrl: m.photo_url }))
    }
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  const positioned: PositionedConnection[] = connections.map((c, i) => {
    const angle = (2 * Math.PI * i) / connections.length - Math.PI / 2
    const RADIUS_PCT = 36
    return {
      ...c,
      x: 50 + RADIUS_PCT * Math.cos(angle),
      y: 50 + RADIUS_PCT * Math.sin(angle),
      size: nodeSize(c.longestStreak),
      photoUrl: photoByMemberId.get(c.memberId) ?? null,
    }
  })

  return (
    <div className="container mx-auto px-6 py-8">
      <h1 className="text-3xl font-bold mb-2">Network</h1>
      <p className="text-slate-500 dark:text-slate-400 text-sm mb-8">
        Hedgies you&apos;ve built a sister streak with — showing up to the same prickle, week after week.
      </p>

      {hasConnections ? (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 md:p-10">
          <div className="relative mx-auto" style={{ maxWidth: 560, aspectRatio: "1 / 1" }}>
            <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full" aria-hidden="true">
              {positioned.map((c) => (
                <line
                  key={c.memberId}
                  x1={50}
                  y1={50}
                  x2={c.x}
                  y2={c.y}
                  strokeWidth={lineWidth(c.currentStreak)}
                  strokeLinecap="round"
                  className={
                    c.currentStreak > 0
                      ? "stroke-orange-300 dark:stroke-orange-700"
                      : "stroke-slate-200 dark:stroke-slate-700"
                  }
                />
              ))}
            </svg>

            <Link
              href={`/members/${memberId}`}
              className="absolute flex flex-col items-center gap-1.5"
              style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
            >
              <AvatarCircle name={memberName} photoUrl={memberPhotoUrl} size={88} ring />
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                {memberName} (you)
              </span>
            </Link>

            {positioned.map((c) => (
              <Link
                key={c.memberId}
                href={`/members/${c.memberId}`}
                className="absolute flex flex-col items-center gap-1 group"
                style={{ left: `${c.x}%`, top: `${c.y}%`, transform: "translate(-50%, -50%)" }}
              >
                <AvatarCircle name={c.memberName} photoUrl={c.photoUrl} size={c.size} />
                <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap group-hover:underline">
                  {c.currentStreak > 0 && <span className="mr-0.5">🔥</span>}
                  {c.memberName}
                </span>
                <span className="text-[10px] text-slate-400 dark:text-slate-500">
                  {c.currentStreak}w current · {c.longestStreak}w best
                </span>
              </Link>
            ))}
          </div>

          <p className="text-center text-xs text-slate-400 dark:text-slate-500 mt-6">
            Circle size reflects your longest streak together; line color shows an active streak.
          </p>

          {totalConnections > connections.length && (
            <p className="text-center text-xs text-slate-400 mt-2">
              Showing top {connections.length} of {totalConnections}.{" "}
              <Link href="/streaks" className="text-blue-600 dark:text-blue-400 hover:underline">
                See all on Streaks →
              </Link>
            </p>
          )}
        </div>
      ) : (
        <div>
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-8 text-center">
            <div className="text-4xl mb-3" aria-hidden>
              🌱
            </div>
            <h2 className="text-lg font-semibold mb-2">
              Not connected yet? Looks like you&apos;re ready for new connections!
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Sister streaks form when you and another hedgie show up to the same prickle, week after
              week. Here are a few ways to get started.
            </p>
          </div>

          <div className="grid gap-4 mt-6 sm:grid-cols-2 lg:grid-cols-3">
            {!hasPostedInSlack && (
              <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6">
                <div className="text-2xl mb-2" aria-hidden>
                  👋
                </div>
                <h3 className="font-semibold mb-1">Introduce yourself</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                  Say hi in #start-here on Slack — it&apos;s the easiest way to get on other hedgies&apos;
                  radar.
                </p>
                {slackStartHereUrl && (
                  <Link
                    href={slackStartHereUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Open #start-here →
                  </Link>
                )}
              </div>
            )}

            <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6">
              <div className="text-2xl mb-2" aria-hidden>
                🕐
              </div>
              <h3 className="font-semibold mb-1">Prickle times to join</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                Well-attended sessions coming up soon:
              </p>
              {prickleSuggestions.length > 0 ? (
                <ul className="space-y-2 mb-3">
                  {prickleSuggestions.map((p) => (
                    <li key={p.slotLabel} className="text-sm">
                      <span className="font-medium text-slate-700 dark:text-slate-300">{p.typeName}</span>
                      <span className="text-slate-400 dark:text-slate-500"> · {p.slotLabel}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-400 mb-3">Check the calendar for upcoming sessions.</p>
              )}
              <Link
                href="/prickle-picker"
                className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                Try the Prickle Picker →
              </Link>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6">
              <div className="text-2xl mb-2" aria-hidden>
                ⭐
              </div>
              <h3 className="font-semibold mb-1">Well-connected hedgies</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                Attend a prickle with one of these regulars:
              </p>
              {wellConnected.length > 0 ? (
                <ul className="space-y-2.5">
                  {wellConnected.map((m) => (
                    <li key={m.id}>
                      <Link
                        href={`/members/${m.id}`}
                        className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:underline"
                      >
                        <AvatarCircle name={m.name} photoUrl={m.photoUrl} size={28} />
                        {m.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-400">Check back once more prickles have run.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
