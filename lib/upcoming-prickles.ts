import { createClient } from "@/lib/supabase/server"
import {
  computePrickleStreaks,
  computeSisterStreaks,
  isEstablishedSisterStreak,
  seriesKeyFor,
  type PrickleStreak,
  type SisterStreak,
} from "@/lib/streaks"
import { getMemberDisplayName } from "@/lib/member-display-name"

// Shared by the Dashboard's "what should I do next" surface and the My
// Prickles "Upcoming" tab — both rank the same set of upcoming prickles by
// the same hosting/streak/sister-attendance signals, just over different
// windows and display caps. Keeping the computation in one place avoids two
// copies of this (fairly involved) ranking logic drifting apart.

const BATCH_SIZE = 1000
// How far back to look for a sister-streak sister's last couple of
// occurrences of a recurring series. Weekly cadence, so 60 days comfortably
// covers "last 2 occurrences" even through a skipped week or two.
const SISTER_LOOKBACK_DAYS = 60

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

type RawUpcomingPrickle = {
  id: string
  type_id: string | null
  start_time: string
  prickle_types: { name: string } | { name: string }[] | null
  host: { id: string; name: string; display_name: string | null } | { id: string; name: string; display_name: string | null }[] | null
}

export type UpcomingPrickle = {
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

export interface HighlightReason {
  kind: "hosting" | "streak" | "lostStreak" | "sister"
  tooltip: string[]
}

type SisterSignal = {
  name: string
  attendedCount: number
  totalOccurrences: number
  currentStreak: number
}

function sisterReasonText(signal: SisterSignal): string {
  const { attendedCount, totalOccurrences, currentStreak, name } = signal
  if (attendedCount === totalOccurrences && totalOccurrences > 0) {
    return currentStreak > 1
      ? `${name} hasn't missed the last ${totalOccurrences} · ${currentStreak}-week streak with you`
      : `${name} hasn't missed the last ${totalOccurrences}`
  }
  return `${name} came ${attendedCount} of the last ${totalOccurrences}`
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
      .select("id, type_id, start_time, prickle_types(name), host:members(id, name, display_name)")
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
      hostName: host ? getMemberDisplayName(host) : null,
      dayOfWeek,
      startHour,
      seriesKey: seriesKeyFor(typeName, dayOfWeek, startHour),
    }
  })
}

export interface RankedPrickle {
  prickle: UpcomingPrickle
  reasons: HighlightReason[]
  priority: number
  sortValue: number
}

/**
 * Upcoming prickles in `[now, now + windowDays]`, ranked highest-priority
 * first: hosting > active streak > high-likelihood sister attendance > lost
 * streak > everything else chronologically. Callers decide how much of the
 * list to show (Dashboard caps it; My Prickles shows the full window).
 */
export async function getRankedUpcomingPrickles(
  supabase: SupabaseClient,
  memberId: string,
  timeZone: string,
  now: Date,
  windowDays: number
): Promise<RankedPrickle[]> {
  const windowStart = now.toISOString()
  const windowEnd = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000).toISOString()

  const upcoming = await fetchUpcomingPrickles(supabase, windowStart, windowEnd, timeZone)

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
    members:
      | { name: string; display_name: string | null }
      | { name: string; display_name: string | null }[]
      | null
  }
  let coAttendance: CoRecord[] = []
  const PRICKLE_BATCH = 100
  for (let i = 0; i < myPrickleIds.length; i += PRICKLE_BATCH) {
    const prickleBatch = myPrickleIds.slice(i, i + PRICKLE_BATCH)
    const batchRows = await fetchAllPaginated<CoRecord>((offset) =>
      supabase
        .from("prickle_attendance")
        .select("member_id, prickle_id, join_time, members(name, display_name)")
        .in("prickle_id", prickleBatch)
        .neq("member_id", memberId)
        .range(offset, offset + BATCH_SIZE - 1)
    )
    coAttendance = coAttendance.concat(batchRows)
  }

  const sisterStreaks: SisterStreak[] = computeSisterStreaks(
    myAttendance.map((r) => ({ prickleId: r.prickle_id, joinTime: r.join_time })),
    coAttendance.map((r) => {
      const member = unwrapOne(r.members)
      return {
        memberId: r.member_id,
        memberName: member ? getMemberDisplayName(member) : "Unknown",
        prickleId: r.prickle_id,
        joinTime: r.join_time,
      }
    }),
    now,
    timeZone
  )
  const activeSisters = sisterStreaks.filter(
    (s) => s.currentStreak > 0 && isEstablishedSisterStreak(s)
  )

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
  const sistersBySeries = new Map<string, SisterSignal[]>()
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
        const signals: SisterSignal[] = []
        const highLikelihoodNames: string[] = []
        let maxStreak = 0
        for (const sister of activeSisters) {
          const attendedIds = attendedPrickleIdsByMember.get(sister.memberId)
          if (!attendedIds) continue
          const attendedCount = occurrenceIds.filter((id) => attendedIds.has(id)).length
          if (attendedCount > 0) {
            signals.push({
              name: sister.memberName,
              attendedCount,
              totalOccurrences: occurrenceIds.length,
              currentStreak: sister.currentStreak,
            })
          }
          // High likelihood: attended every recent occurrence we have on record.
          if (attendedCount === occurrenceIds.length) {
            highLikelihoodNames.push(sister.memberName)
            maxStreak = Math.max(maxStreak, sister.currentStreak)
          }
        }
        if (signals.length > 0) sistersBySeries.set(seriesKey, signals)
        if (highLikelihoodNames.length > 0) {
          highLikelihoodSistersBySeries.set(seriesKey, { names: highLikelihoodNames, maxStreak })
        }
      }
    }
  }

  // ---- Rank upcoming prickles: hosting first, then active streaks (longest
  // first), then high-likelihood sister-streak sisters (an unbroken sister
  // streak who's attended every recent occurrence), then lost streaks
  // (longest first), then everything else in chronological order. ----
  const ranked: RankedPrickle[] = upcoming.map((p) => {
    const reasons: HighlightReason[] = []
    let priority = 4
    let sortValue = new Date(p.startTime).getTime()

    if (p.hostId === memberId) {
      reasons.push({ kind: "hosting", tooltip: ["You're hosting this one"] })
      priority = 0
    }

    const streakWeeks = activeStreakBySeries.get(p.seriesKey)
    if (streakWeeks) {
      reasons.push({ kind: "streak", tooltip: [`${streakWeeks}-week streak here`] })
      if (priority > 1) {
        priority = 1
        sortValue = -streakWeeks
      }
    }

    const sisterSignals = sistersBySeries.get(p.seriesKey)
    if (sisterSignals && sisterSignals.length > 0) {
      reasons.push({ kind: "sister", tooltip: sisterSignals.slice(0, 3).map(sisterReasonText) })
    }

    const highLikelihoodSister = highLikelihoodSistersBySeries.get(p.seriesKey)
    if (highLikelihoodSister && priority > 2) {
      priority = 2
      sortValue = -highLikelihoodSister.maxStreak
    }

    const lostStreakWeeks = lostStreakBySeries.get(p.seriesKey)
    if (lostStreakWeeks) {
      reasons.push({ kind: "lostStreak", tooltip: [`Lost a ${lostStreakWeeks}-week streak here`] })
      if (priority > 3) {
        priority = 3
        sortValue = -lostStreakWeeks
      }
    }

    return { prickle: p, reasons, priority, sortValue }
  })

  ranked.sort((a, b) => a.priority - b.priority || a.sortValue - b.sortValue)
  return ranked
}
