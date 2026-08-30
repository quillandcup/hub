import type { Metadata } from "next"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { getEffectiveIdentity } from "@/lib/sudo"
import { getUserTimezonePreference } from "@/lib/timezone"
import { hostShortName } from "@/lib/formatters"
import { getStarredGoals } from "../writing/actions"
import GoalDisplay from "@/components/writing/GoalDisplay"
import {
  computePrickleStreaks,
  computeSisterStreaks,
  type PrickleStreak,
  type SisterStreak,
} from "@/lib/streaks"

export const metadata: Metadata = {
  title: "Dashboard",
}

const ORG_TIMEZONE = "America/New_York"
const UPCOMING_WINDOW_DAYS = 7
const MAX_UPCOMING_DISPLAY = 5
// How far back to look for a sister-streak sister's last couple of
// occurrences of a recurring series. Weekly cadence, so 60 days comfortably
// covers "last 2 occurrences" even through a skipped week or two.
const SISTER_LOOKBACK_DAYS = 60
const BATCH_SIZE = 1000

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

// `data` is typed `unknown` (rather than `T[] | null`) so this helper can
// accept any Supabase query builder, regardless of how it infers embedded
// relationship cardinality (Supabase's generated types don't always agree
// with the shape we know we'll get back from a to-one embed).
async function fetchAllPaginated<T>(
  queryFn: (offset: number) => PromiseLike<{ data: unknown }>
): Promise<T[]> {
  let all: T[] = []
  let offset = 0
  let hasMore = true
  while (hasMore) {
    const { data } = await queryFn(offset)
    const batch = (data as T[] | null) ?? []
    if (batch.length > 0) {
      all = all.concat(batch)
      offset += batch.length
      hasMore = batch.length === BATCH_SIZE
    } else {
      hasMore = false
    }
  }
  return all
}

function unwrapOne<T>(ref: T | T[] | null | undefined): T | null {
  if (Array.isArray(ref)) return ref[0] ?? null
  return ref ?? null
}

function getLocalDayAndHour(iso: string, timeZone: string): { dayOfWeek: string; startHour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date(iso))
  const dayOfWeek = parts.find((p) => p.type === "weekday")?.value ?? ""
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0"
  return { dayOfWeek, startHour: parseInt(hourStr, 10) % 24 }
}

function seriesKeyFor(typeName: string, dayOfWeek: string, startHour: number): string {
  return `${typeName}|${dayOfWeek}|${startHour}`
}

function formatUpcomingTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

type RawUpcomingPrickle = {
  id: string
  type_id: string | null
  start_time: string
  prickle_types: { name: string } | { name: string }[] | null
  host: { id: string; name: string } | { id: string; name: string }[] | null
}

type UpcomingPrickle = {
  id: string
  typeId: string | null
  typeName: string
  startTime: string
  hostId: string | null
  hostName: string | null
  dayOfWeek: string
  startHour: number
  seriesKey: string
}

interface HighlightReason {
  kind: "hosting" | "streak" | "lostStreak" | "sister"
  label: string
}

async function fetchUpcomingPrickles(
  supabase: SupabaseClient,
  windowStart: string,
  windowEnd: string,
  timeZone: string
): Promise<UpcomingPrickle[]> {
  const raw = await fetchAllPaginated<RawUpcomingPrickle>((offset) =>
    supabase
      .from("prickles")
      .select("id, type_id, start_time, prickle_types(name), host:members(id, name)")
      .gte("start_time", windowStart)
      .lte("start_time", windowEnd)
      .order("start_time")
      .range(offset, offset + BATCH_SIZE - 1)
  )

  return raw.map((p) => {
    const type = unwrapOne(p.prickle_types)
    const host = unwrapOne(p.host)
    const { dayOfWeek, startHour } = getLocalDayAndHour(p.start_time, timeZone)
    const typeName = type?.name ?? "Prickle"
    return {
      id: p.id,
      typeId: p.type_id,
      typeName,
      startTime: p.start_time,
      hostId: host?.id ?? null,
      hostName: host?.name ?? null,
      dayOfWeek,
      startHour,
      seriesKey: seriesKeyFor(typeName, dayOfWeek, startHour),
    }
  })
}

export default async function DashboardPage() {
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

  const now = new Date()
  const windowStart = now.toISOString()
  const windowEnd = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const [upcoming, starredGoals] = await Promise.all([
    fetchUpcomingPrickles(supabase, windowStart, windowEnd, timeZone),
    getStarredGoals(),
  ])

  // ---- This member's attendance history, used for both prickle streaks and
  // sister-streak co-attendance below. ----
  type MyRecord = {
    prickle_id: string
    join_time: string
    prickles: { start_time: string; prickle_types: { name: string } | null } | null
  }
  const myAttendance = await fetchAllPaginated<MyRecord>((offset) =>
    supabase
      .from("prickle_attendance")
      .select("prickle_id, join_time, prickles(start_time, prickle_types(name))")
      .eq("member_id", memberId)
      .range(offset, offset + BATCH_SIZE - 1)
  )

  // ---- Prickle streaks: which recurring series (type + day-of-week + hour)
  // does this member currently have an active streak on? ----
  const prickleStreaks: PrickleStreak[] = computePrickleStreaks(
    myAttendance
      .filter((r) => r.prickles?.prickle_types?.name && r.prickles?.start_time)
      .map((r) => ({
        prickleTypeName: r.prickles!.prickle_types!.name,
        joinTime: r.join_time,
        prickleStartTime: r.prickles!.start_time,
      })),
    now,
    timeZone
  )
  const activeStreakBySeries = new Map<string, number>()
  for (const s of prickleStreaks) {
    if (s.currentStreak > 0) {
      activeStreakBySeries.set(seriesKeyFor(s.prickleTypeName, s.dayOfWeek, s.startHour), s.currentStreak)
    }
  }

  // ---- Lost prickle streaks: series where this member once had a real
  // streak (2+ weeks) but has since broken it. ----
  const lostStreakBySeries = new Map<string, number>()
  for (const s of prickleStreaks) {
    if (s.currentStreak === 0 && s.longestStreak >= 2) {
      lostStreakBySeries.set(seriesKeyFor(s.prickleTypeName, s.dayOfWeek, s.startHour), s.longestStreak)
    }
  }

  // ---- Sister streaks: members with an active co-attendance streak. ----
  const myPrickleIds = [...new Set(myAttendance.map((r) => r.prickle_id))]
  type CoRecord = {
    member_id: string
    prickle_id: string
    join_time: string
    members: { name: string } | { name: string }[] | null
  }
  let coAttendance: CoRecord[] = []
  const PRICKLE_BATCH = 100
  for (let i = 0; i < myPrickleIds.length; i += PRICKLE_BATCH) {
    const prickleBatch = myPrickleIds.slice(i, i + PRICKLE_BATCH)
    const batchRows = await fetchAllPaginated<CoRecord>((offset) =>
      supabase
        .from("prickle_attendance")
        .select("member_id, prickle_id, join_time, members(name)")
        .in("prickle_id", prickleBatch)
        .neq("member_id", memberId)
        .range(offset, offset + BATCH_SIZE - 1)
    )
    coAttendance = coAttendance.concat(batchRows)
  }

  const sisterStreaks: SisterStreak[] = computeSisterStreaks(
    myAttendance.map((r) => ({ prickleId: r.prickle_id, joinTime: r.join_time })),
    coAttendance.map((r) => ({
      memberId: r.member_id,
      memberName: unwrapOne(r.members)?.name ?? "Unknown",
      prickleId: r.prickle_id,
      joinTime: r.join_time,
    })),
    now,
    timeZone
  )
  const activeSisters = sisterStreaks.filter((s) => s.currentStreak > 0)

  // ---- Sister-likely-attending: lightweight historical-pattern heuristic.
  // For each upcoming series a sister-streak sister might show up to, check
  // whether they attended that same series in at least one of its last 2
  // occurrences before now. This is NOT a confirmed RSVP -- attendance for a
  // future prickle is never knowable in advance (see CLAUDE.md), just a
  // "they usually come to this one" signal.
  //
  // `highLikelihoodSistersBySeries` is a stricter cut of the same data --
  // sisters who attended EVERY recent occurrence on record (not just one of
  // the last 2) -- used to decide whether the signal is strong enough to
  // outrank a personal lost streak, not just to earn a badge. ----
  const sistersBySeries = new Map<string, string[]>()
  const highLikelihoodSistersBySeries = new Map<string, { names: string[]; maxStreak: number }>()
  if (activeSisters.length > 0 && upcoming.length > 0) {
    const seriesKeysInUpcoming = new Set(upcoming.map((p) => p.seriesKey))
    const typeIdsInUpcoming = [...new Set(upcoming.map((p) => p.typeId).filter((id): id is string => !!id))]

    if (typeIdsInUpcoming.length > 0) {
      const lookbackStart = new Date(now.getTime() - SISTER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

      type RawHistPrickle = {
        id: string
        start_time: string
        prickle_types: { name: string } | { name: string }[] | null
      }
      const histPrickles = await fetchAllPaginated<RawHistPrickle>((offset) =>
        supabase
          .from("prickles")
          .select("id, start_time, prickle_types(name)")
          .in("type_id", typeIdsInUpcoming)
          .gte("start_time", lookbackStart)
          .lt("start_time", windowStart)
          .order("start_time", { ascending: false })
          .range(offset, offset + BATCH_SIZE - 1)
      )

      // Most-recent-first per series -- keep the last 2 occurrences of each.
      const seriesOccurrences = new Map<string, string[]>()
      for (const p of histPrickles) {
        const typeName = unwrapOne(p.prickle_types)?.name ?? "Prickle"
        const { dayOfWeek, startHour } = getLocalDayAndHour(p.start_time, timeZone)
        const key = seriesKeyFor(typeName, dayOfWeek, startHour)
        if (!seriesKeysInUpcoming.has(key)) continue
        const list = seriesOccurrences.get(key) ?? []
        if (list.length < 2) {
          list.push(p.id)
          seriesOccurrences.set(key, list)
        }
      }

      const candidateOccurrenceIds = [...new Set([...seriesOccurrences.values()].flat())]
      const sisterIds = activeSisters.map((s) => s.memberId)

      let sisterAttendance: { member_id: string; prickle_id: string }[] = []
      if (candidateOccurrenceIds.length > 0 && sisterIds.length > 0) {
        sisterAttendance = await fetchAllPaginated<{ member_id: string; prickle_id: string }>((offset) =>
          supabase
            .from("prickle_attendance")
            .select("member_id, prickle_id")
            .in("prickle_id", candidateOccurrenceIds)
            .in("member_id", sisterIds)
            .range(offset, offset + BATCH_SIZE - 1)
        )
      }

      const attendedPrickleIdsByMember = new Map<string, Set<string>>()
      for (const a of sisterAttendance) {
        const set = attendedPrickleIdsByMember.get(a.member_id) ?? new Set<string>()
        set.add(a.prickle_id)
        attendedPrickleIdsByMember.set(a.member_id, set)
      }

      for (const [seriesKey, occurrenceIds] of seriesOccurrences) {
        const names: string[] = []
        const highLikelihoodNames: string[] = []
        let maxStreak = 0
        for (const sister of activeSisters) {
          const attendedIds = attendedPrickleIdsByMember.get(sister.memberId)
          if (!attendedIds) continue
          const attendedCount = occurrenceIds.filter((id) => attendedIds.has(id)).length
          if (attendedCount > 0) names.push(sister.memberName)
          // High likelihood: attended every recent occurrence we have on record.
          if (attendedCount === occurrenceIds.length) {
            highLikelihoodNames.push(sister.memberName)
            maxStreak = Math.max(maxStreak, sister.currentStreak)
          }
        }
        if (names.length > 0) sistersBySeries.set(seriesKey, names)
        if (highLikelihoodNames.length > 0) {
          highLikelihoodSistersBySeries.set(seriesKey, { names: highLikelihoodNames, maxStreak })
        }
      }
    }
  }

  // ---- Rank upcoming prickles: hosting first, then active streaks (longest
  // first), then high-likelihood sister-streak sisters (an unbroken sister
  // streak who's attended every recent occurrence), then lost streaks
  // (longest first), then everything else in chronological order -- capped
  // to MAX_UPCOMING_DISPLAY total. ----
  type RankedPrickle = { prickle: UpcomingPrickle; reasons: HighlightReason[]; priority: number; sortValue: number }

  const ranked: RankedPrickle[] = upcoming.map((p) => {
    const reasons: HighlightReason[] = []
    let priority = 4
    let sortValue = new Date(p.startTime).getTime()

    if (p.hostId === memberId) {
      reasons.push({ kind: "hosting", label: "You're hosting" })
      priority = 0
    }

    const streakWeeks = activeStreakBySeries.get(p.seriesKey)
    if (streakWeeks) {
      reasons.push({ kind: "streak", label: `${streakWeeks}-week streak here` })
      if (priority > 1) {
        priority = 1
        sortValue = -streakWeeks
      }
    }

    const sisterNames = sistersBySeries.get(p.seriesKey)
    if (sisterNames && sisterNames.length > 0) {
      const label =
        sisterNames.length <= 2
          ? `${sisterNames.map(hostShortName).join(" & ")} usually shows up`
          : `${sisterNames.slice(0, 2).map(hostShortName).join(", ")} +${sisterNames.length - 2} usually show up`
      reasons.push({ kind: "sister", label })
    }

    const highLikelihoodSister = highLikelihoodSistersBySeries.get(p.seriesKey)
    if (highLikelihoodSister && priority > 2) {
      priority = 2
      sortValue = -highLikelihoodSister.maxStreak
    }

    const lostStreakWeeks = lostStreakBySeries.get(p.seriesKey)
    if (lostStreakWeeks) {
      reasons.push({ kind: "lostStreak", label: `Lost a ${lostStreakWeeks}-week streak here` })
      if (priority > 3) {
        priority = 3
        sortValue = -lostStreakWeeks
      }
    }

    return { prickle: p, reasons, priority, sortValue }
  })

  ranked.sort((a, b) => a.priority - b.priority || a.sortValue - b.sortValue)
  const displayedUpcoming = ranked.slice(0, MAX_UPCOMING_DISPLAY)

  const firstName = effectiveIdentity.memberName?.split(" ")[0]

  return (
    <div className="container mx-auto px-6 py-8 max-w-2xl">
      <h1 className="text-3xl font-bold mb-2">Welcome back{firstName ? `, ${firstName}` : ""}</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">
        Here&apos;s what&apos;s coming up in the next {UPCOMING_WINDOW_DAYS} days.
      </p>

      {starredGoals.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
          <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
            Writing Goals
          </h2>
          <div className="space-y-4">
            {starredGoals.map((goal) => (
              <div key={goal.id}>
                <Link
                  href={`/writing/${goal.projectId}`}
                  className="text-sm font-medium text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400"
                >
                  {goal.projectTitle}
                </Link>
                <div className="mt-1">
                  <GoalDisplay goal={goal} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {upcoming.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No prickles scheduled in the next {UPCOMING_WINDOW_DAYS} days.
          </p>
          <Link
            href="/calendar"
            className="inline-block mt-3 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            View the full calendar →
          </Link>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6">
          <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
            Upcoming Prickles
          </h2>
          <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
            Sorted for you: hosting duties first, then active streaks, then sisters who reliably show up,
            then streaks you&apos;ve lost. &quot;Likely to attend&quot; is a pattern from past history, not
            a confirmed RSVP.
          </p>
          <div>
            {displayedUpcoming.map(({ prickle, reasons }) => (
              <UpcomingRow key={prickle.id} prickle={prickle} reasons={reasons} timeZone={timeZone} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const REASON_ICON: Record<HighlightReason["kind"], string> = {
  hosting: "🎤",
  streak: "🔥",
  lostStreak: "💔",
  sister: "🤝",
}

function UpcomingRow({
  prickle,
  reasons,
  timeZone,
}: {
  prickle: UpcomingPrickle
  reasons: HighlightReason[]
  timeZone: string
}) {
  return (
    <Link
      href={`/prickles/${prickle.id}`}
      className="block py-3 border-b border-slate-100 dark:border-slate-800 last:border-0 -mx-2 px-2 rounded hover:bg-slate-50 dark:hover:bg-slate-800/50"
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{prickle.typeName}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {prickle.hostName ? `Hosted by ${hostShortName(prickle.hostName)}` : "No host listed"}
          </p>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 flex-shrink-0 ml-4 text-right">
          {formatUpcomingTime(prickle.startTime, timeZone)}
        </p>
      </div>
      {reasons.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {reasons.map((r) => (
            <span
              key={r.kind}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
            >
              <span aria-hidden>{REASON_ICON[r.kind]}</span>
              {r.label}
            </span>
          ))}
        </div>
      )}
    </Link>
  )
}
