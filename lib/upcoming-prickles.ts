import type { createClient } from "@/lib/supabase/server"
import {
  computePrickleStreaks,
  computeSisterStreaks,
  isEstablishedSisterStreak,
  seriesKeyFor,
  type PrickleStreak,
  type SisterStreak,
} from "@/lib/streaks"
import { getMemberDisplayName } from "@/lib/member-display-name"
import {
  computeCommitmentProgress,
  effectiveCommitmentStatus,
  prickleMatchesSlot,
  type Commitment,
  type CommitmentSlot,
  type CommitmentStatus,
  type SlotPrickle,
} from "@/lib/commitments"
import {
  RECOMMENDATION_LOOKBACK_DAYS,
  computeHostExperience,
  computeSlotVibrancy,
  localDayAndTimeOfDay,
  orderWithDiversity,
  recommendationReasons,
  scoreRecommendation,
  type HostExperience,
  type PastAttendance,
  type PastPrickle,
  type RecommendationReasonKind,
  type SlotVibrancy,
} from "@/lib/prickle-recommendations"

// Shared by the Dashboard's "what should I do next" surface and the My
// Prickles "Upcoming" tab — both rank the same set of upcoming prickles by
// the same hosting/streak/sister-attendance signals, just over different
// windows and display caps. Keeping the computation in one place avoids two
// copies of this (fairly involved) ranking logic drifting apart.
//
// When a member has no personal signal for a prickle, it's ranked by
// community recommendation signals instead (experienced host, popular slot,
// lots of regulars -- see lib/prickle-recommendations.ts), spread across days
// so a newer member sees a strong, varied set rather than just the next few
// start times.

const BATCH_SIZE = 1000
// How far back to look for a sister-streak sister's last couple of
// occurrences of a recurring series. Weekly cadence, so 60 days comfortably
// covers "last 2 occurrences" even through a skipped week or two. Shared with
// the recommendation lookback so one past-prickle fetch serves both.
const SISTER_LOOKBACK_DAYS = RECOMMENDATION_LOOKBACK_DAYS
// Prickle IDs per `.in()` filter -- keeps the request URL well under limits.
const PRICKLE_ID_BATCH = 100
const HOST_ID_BATCH = 100

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

/** Runs `fetchChunk` over `ids` in `.in()`-sized chunks, in parallel, and concatenates. */
async function fetchInChunks<T>(ids: string[], chunkSize: number, fetchChunk: (chunk: string[]) => Promise<T[]>) {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize))
  const results = await Promise.all(chunks.map(fetchChunk))
  return results.flat()
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

type RawHost = { id: string; name: string; display_name: string | null }

type RawUpcomingPrickle = {
  id: string
  type_id: string | null
  start_time: string
  prickle_types: { name: string } | { name: string }[] | null
  host: RawHost | RawHost[] | null
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
  kind: "hosting" | "commitment" | "calendar" | "streak" | "lostStreak" | "sister" | RecommendationReasonKind
  tooltip: string[]
}

export type SisterSignal = {
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

function toUpcomingPrickle(p: RawUpcomingPrickle, timeZone: string): UpcomingPrickle {
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
}

/** Prickles with start_time in [from, to) (or [from, to] when `inclusiveEnd`), oldest first. */
async function fetchPrickles(
  supabase: SupabaseClient,
  from: string,
  to: string,
  timeZone: string,
  inclusiveEnd: boolean
): Promise<UpcomingPrickle[]> {
  const raw = await fetchAllPaginated<RawUpcomingPrickle>((offset) => {
    const q = supabase
      .from("prickles")
      .select("id, type_id, start_time, prickle_types(name), host:prickle_host(id, name, display_name)")
      .gte("start_time", from)
    return (inclusiveEnd ? q.lte("start_time", to) : q.lt("start_time", to))
      .order("start_time")
      .order("id")
      .range(offset, offset + BATCH_SIZE - 1)
  })
  return raw.map((p) => toUpcomingPrickle(p, timeZone))
}

/** Every attendance row (multiple per member/prickle is normal -- leave/rejoin) for these prickles. */
async function fetchAttendanceForPrickles(supabase: SupabaseClient, prickleIds: string[]): Promise<PastAttendance[]> {
  type Row = { prickle_id: string; member_id: string; join_time: string }
  const rows = await fetchInChunks(prickleIds, PRICKLE_ID_BATCH, (chunk) =>
    fetchAllPaginated<Row>((offset) =>
      supabase
        .from("prickle_attendance")
        .select("prickle_id, member_id, join_time")
        .in("prickle_id", chunk)
        .order("id")
        .range(offset, offset + BATCH_SIZE - 1)
    )
  )
  return rows.map((r) => ({ prickleId: r.prickle_id, memberId: r.member_id, joinTime: r.join_time }))
}

/** All-time count of already-started prickles hosted by each of `hostIds`. Only the `host` column
 * is selected, so even a long hosting history is a small payload. */
async function fetchHostedCounts(
  supabase: SupabaseClient,
  hostIds: string[],
  before: string
): Promise<Map<string, number>> {
  const rows = await fetchInChunks(hostIds, HOST_ID_BATCH, (chunk) =>
    fetchAllPaginated<{ host: string }>((offset) =>
      supabase
        .from("prickles")
        .select("host")
        .in("host", chunk)
        .lt("start_time", before)
        .order("id")
        .range(offset, offset + BATCH_SIZE - 1)
    )
  )
  const counts = new Map<string, number>(hostIds.map((id) => [id, 0]))
  for (const r of rows) counts.set(r.host, (counts.get(r.host) ?? 0) + 1)
  return counts
}

/**
 * Ranking tiers, lowest first. Hosting stays on top (the session can't run without you); an
 * explicit commitment comes next -- it's a promise the member made about this exact occurrence,
 * a stronger and more deliberate signal than a streak, which is only inferred from past
 * behavior (and usually accompanies the commitment anyway, so the member sees both badges).
 * A prickle the member added to their calendar by hand is the same kind of deliberate choice, a
 * lighter one than a commitment, so it sits between the two.
 */
export const PRIORITY = {
  hosting: 0,
  commitment: 1,
  calendar: 2,
  streak: 3,
  sister: 4,
  lostStreak: 5,
  none: 6,
} as const

/** The member's commitments with stored status 'active' (a member has only a handful, but
 * paginated anyway per CLAUDE.md). Like the other fetches here, a query error yields no rows, so
 * the Upcoming list still renders -- just without commitment badges. */
async function fetchActiveCommitments(supabase: SupabaseClient, memberId: string): Promise<Commitment[]> {
  type SlotRow = { type_id: string; day_of_week: number; start_time_local: string; timezone: string }
  type Row = {
    id: string
    start_date: string
    weeks: number
    status: CommitmentStatus
    cancelled_at: string | null
    prickle_commitment_slots: SlotRow[] | null
  }
  const rows = await fetchAllPaginated<Row>((offset) =>
    supabase
      .from("prickle_commitments")
      .select(
        "id, start_date, weeks, status, cancelled_at, prickle_commitment_slots(type_id, day_of_week, start_time_local, timezone)"
      )
      .eq("member_id", memberId)
      .eq("status", "active")
      .order("id")
      .range(offset, offset + BATCH_SIZE - 1)
  )
  return rows.map((r) => ({
    id: r.id,
    startDate: r.start_date,
    weeks: r.weeks,
    status: r.status,
    cancelledAt: r.cancelled_at,
    slots: (r.prickle_commitment_slots ?? []).map(
      (s): CommitmentSlot => ({
        typeId: s.type_id,
        dayOfWeek: s.day_of_week,
        startTimeLocal: s.start_time_local,
        timezone: s.timezone,
      })
    ),
  }))
}

/** How an upcoming prickle got into the member's calendar feed by hand (calendar_feed_items). */
export type CalendarAddedMode = "once" | "weekly"

export type CalendarItemRow = {
  kind: "prickle" | "slot"
  prickle_id: string | null
  type_id: string | null
  day_of_week: number | null
  start_time_local: string | null
  timezone: string | null
}

/** The member's hand-added calendar items (just this prickle, or a weekly slot). Events aren't
 * prickles, so they're skipped. A query error yields no rows, like the other fetches here. */
async function fetchCalendarItems(supabase: SupabaseClient, memberId: string): Promise<CalendarItemRow[]> {
  return fetchAllPaginated<CalendarItemRow>((offset) =>
    supabase
      .from("calendar_feed_items")
      .select("kind, prickle_id, type_id, day_of_week, start_time_local, timezone")
      .eq("member_id", memberId)
      .in("kind", ["prickle", "slot"])
      .order("id")
      .range(offset, offset + BATCH_SIZE - 1)
  )
}

/** Upcoming prickle id -> how the member added it to their calendar. Weekly slots match the same
 * way the feed does (lib/calendar-feed.ts, prickleMatchesSlot); "once" wins if both apply. */
export function computeCalendarAdded(
  items: CalendarItemRow[],
  upcoming: Pick<UpcomingPrickle, "id" | "typeId" | "startTime">[]
): Map<string, CalendarAddedMode> {
  const result = new Map<string, CalendarAddedMode>()
  const onceIds = new Set(items.filter((i) => i.kind === "prickle" && i.prickle_id).map((i) => i.prickle_id!))
  const slots = items
    .filter((i) => i.kind === "slot" && i.type_id && i.day_of_week != null && i.start_time_local && i.timezone)
    .map((i) => ({ typeId: i.type_id!, dayOfWeek: i.day_of_week!, startTimeLocal: i.start_time_local!, timezone: i.timezone! }))
  for (const p of upcoming) {
    if (onceIds.has(p.id)) result.set(p.id, "once")
    else if (p.typeId && slots.some((slot) => prickleMatchesSlot(p, slot))) result.set(p.id, "weekly")
  }
  return result
}

export interface RankedPrickle {
  prickle: UpcomingPrickle
  reasons: HighlightReason[]
  /** See PRIORITY: 0 hosting, 1 commitment, 2 added to calendar, 3 active streak, 4
   * high-likelihood sister, 5 lost streak, 6 no personal signal. */
  priority: number
  /** Within-priority sort key (lower first) for personal tiers; position in the diversified
   * recommendation order for PRIORITY.none. */
  sortValue: number
  /** Community recommendation score in [0, 1] (host experience, popularity, regulars). */
  recommendationScore: number
}

/** An upcoming prickle that is one occurrence of one of the viewer's active commitments. */
export interface CommitmentSignal {
  commitmentId: string
  /** 1-based week of the commitment this prickle falls in. */
  week: number
  weeks: number
  /** Committed sessions per week (the commitment's slot count, e.g. 3 for M/W/F). */
  sessionsPerWeek: number
  /** Sessions already kept (attended) so far, across all the commitment's slots. */
  kept: number
}

function commitmentReasonText(s: CommitmentSignal): string {
  const base = `Week ${s.week} of ${s.weeks}`
  if (s.kept === 0) return base
  // One session a week: "kept" counts weeks. Several: say "sessions", so 5 kept in week 2 of a
  // M/W/F commitment doesn't read as 5 weeks.
  if (s.sessionsPerWeek <= 1) return `${base} · ${s.kept} kept so far`
  return `${base} · ${s.kept} ${s.kept === 1 ? "session" : "sessions"} kept so far`
}

/**
 * Which upcoming prickles fall in one of the viewer's active commitments -- a prickle matching
 * ANY slot of a commitment counts -- using lib/commitments' own slot matching
 * (computeCommitmentProgress: same type, committed local weekday/time in the slot's timezone,
 * within the commitment window, closest prickle within MATCH_TOLERANCE_MINUTES). `prickles` should include the upcoming prickles plus any past
 * same-type prickles available (for the kept count); `attendedPrickleIds` is the viewer's
 * distinct attended prickle ids.
 */
export function computeCommitmentSignals(
  commitments: Commitment[],
  prickles: SlotPrickle[],
  attendedPrickleIds: ReadonlySet<string>,
  now: Date
): Map<string, CommitmentSignal> {
  const result = new Map<string, CommitmentSignal>()
  for (const c of commitments) {
    if (effectiveCommitmentStatus(c, now) !== "active") continue
    const progress = computeCommitmentProgress(c, prickles, attendedPrickleIds, now)
    for (const o of progress.occurrences) {
      if (o.status !== "upcoming" || !o.prickleId || result.has(o.prickleId)) continue
      result.set(o.prickleId, {
        commitmentId: c.id,
        week: o.week,
        weeks: c.weeks,
        sessionsPerWeek: c.slots.length,
        kept: progress.kept,
      })
    }
  }
  return result
}

export interface RankingInputs {
  upcoming: UpcomingPrickle[]
  memberId: string
  now: Date
  timeZone: string
  /** Upcoming prickle id -> commitment signal (see computeCommitmentSignals). */
  commitmentByPrickleId?: Map<string, CommitmentSignal>
  /** Upcoming prickle id -> added to the calendar by hand (see computeCalendarAdded). */
  calendarAddedByPrickleId?: Map<string, CalendarAddedMode>
  activeStreakBySeries?: Map<string, number>
  lostStreakBySeries?: Map<string, number>
  sistersBySeries?: Map<string, SisterSignal[]>
  highLikelihoodSistersBySeries?: Map<string, { names: string[]; maxStreak: number }>
  slotVibrancy?: Map<string, SlotVibrancy>
  hostExperience?: Map<string, HostExperience>
}

/**
 * Pure ranking step. Personal signals always win: hosting > commitment
 * (soonest first) > added to calendar (soonest first) > active streak (longest first) > high-likelihood
 * sister-streak sister > lost streak (longest first); within a tier, ties go
 * to the stronger community
 * recommendation, then the earlier start. Everything without a personal
 * signal follows, ordered by community recommendation score with a
 * day / time-of-day / slot diversity and time-proximity balance, all in the
 * viewer's own timezone (see orderWithDiversity).
 */
export function rankUpcomingPrickles(inputs: RankingInputs): RankedPrickle[] {
  const {
    upcoming,
    memberId,
    now,
    timeZone,
    commitmentByPrickleId = new Map(),
    calendarAddedByPrickleId = new Map(),
    activeStreakBySeries = new Map(),
    lostStreakBySeries = new Map(),
    sistersBySeries = new Map(),
    highLikelihoodSistersBySeries = new Map(),
    slotVibrancy = new Map(),
    hostExperience = new Map(),
  } = inputs

  // Local day + time-of-day bucket in the viewer's own timezone, for spreading recommendations.
  const localSlotFor = (iso: string) => localDayAndTimeOfDay(iso, timeZone)

  const ranked: RankedPrickle[] = upcoming.map((p) => {
    const reasons: HighlightReason[] = []
    let priority: number = PRIORITY.none
    let sortValue = new Date(p.startTime).getTime()

    if (p.hostId === memberId) {
      reasons.push({ kind: "hosting", tooltip: ["You're hosting this one"] })
      priority = PRIORITY.hosting
    }

    const commitment = commitmentByPrickleId.get(p.id)
    if (commitment) {
      reasons.push({ kind: "commitment", tooltip: [commitmentReasonText(commitment)] })
      // Soonest first within the tier (sortValue is already the start time).
      if (priority > PRIORITY.commitment) priority = PRIORITY.commitment
    }

    const calendarAdded = calendarAddedByPrickleId.get(p.id)
    if (calendarAdded) {
      reasons.push({
        kind: "calendar",
        tooltip: [calendarAdded === "weekly" ? "You added this one every week" : "You added this one"],
      })
      if (priority > PRIORITY.calendar) priority = PRIORITY.calendar
    }

    const streakWeeks = activeStreakBySeries.get(p.seriesKey)
    if (streakWeeks) {
      reasons.push({ kind: "streak", tooltip: [`${streakWeeks}-week streak here`] })
      if (priority > PRIORITY.streak) {
        priority = PRIORITY.streak
        sortValue = -streakWeeks
      }
    }

    const sisterSignals = sistersBySeries.get(p.seriesKey)
    if (sisterSignals && sisterSignals.length > 0) {
      reasons.push({ kind: "sister", tooltip: sisterSignals.slice(0, 3).map(sisterReasonText) })
    }

    const highLikelihoodSister = highLikelihoodSistersBySeries.get(p.seriesKey)
    if (highLikelihoodSister && priority > PRIORITY.sister) {
      priority = PRIORITY.sister
      sortValue = -highLikelihoodSister.maxStreak
    }

    const lostStreakWeeks = lostStreakBySeries.get(p.seriesKey)
    if (lostStreakWeeks) {
      reasons.push({ kind: "lostStreak", tooltip: [`Lost a ${lostStreakWeeks}-week streak here`] })
      if (priority > PRIORITY.lostStreak) {
        priority = PRIORITY.lostStreak
        sortValue = -lostStreakWeeks
      }
    }

    const host = p.hostId ? hostExperience.get(p.hostId) : undefined
    const slot = slotVibrancy.get(p.seriesKey)
    reasons.push(...recommendationReasons({ hostName: p.hostName, host, slot, viewerIsHost: p.hostId === memberId }))

    return { prickle: p, reasons, priority, sortValue, recommendationScore: scoreRecommendation(host, slot) }
  })

  const startMs = (r: RankedPrickle) => new Date(r.prickle.startTime).getTime()
  const personal = ranked
    .filter((r) => r.priority < PRIORITY.none)
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        a.sortValue - b.sortValue ||
        b.recommendationScore - a.recommendationScore ||
        startMs(a) - startMs(b)
    )

  const byId = new Map(ranked.map((r) => [r.prickle.id, r]))
  const rest = orderWithDiversity(
    ranked
      .filter((r) => r.priority === PRIORITY.none)
      .map((r) => ({
        id: r.prickle.id,
        startTime: r.prickle.startTime,
        ...localSlotFor(r.prickle.startTime),
        seriesKey: r.prickle.seriesKey,
        score: r.recommendationScore,
      })),
    now,
    personal.map((r) => ({ ...localSlotFor(r.prickle.startTime), seriesKey: r.prickle.seriesKey }))
  ).map((c, i) => ({ ...byId.get(c.id)!, sortValue: i }))

  return [...personal, ...rest]
}

/**
 * Upcoming prickles in `[now, now + windowDays]`, ranked highest-priority
 * first (see rankUpcomingPrickles). Callers decide how much of the list to
 * show (Dashboard caps it; My Prickles shows the full window).
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
  const lookbackStart = new Date(now.getTime() - SISTER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // ---- Round 1 (parallel): upcoming prickles, this member's attendance
  // history (for prickle streaks + sister-streak co-attendance), and the
  // recent past prickles (for sister-likely-attending + community
  // recommendation signals), plus this member's active commitments. ----
  type MyRecord = {
    prickle_id: string
    join_time: string
    prickles: { start_time: string; type_id: string | null; prickle_types: { name: string } | null } | null
  }
  const [upcoming, myAttendance, pastPrickles, commitments, calendarItems] = await Promise.all([
    fetchPrickles(supabase, windowStart, windowEnd, timeZone, true),
    fetchAllPaginated<MyRecord>((offset) =>
      supabase
        .from("prickle_attendance")
        .select("prickle_id, join_time, prickles(start_time, type_id, prickle_types(name))")
        .eq("member_id", memberId)
        .order("id")
        .range(offset, offset + BATCH_SIZE - 1)
    ),
    fetchPrickles(supabase, lookbackStart, windowStart, timeZone, false),
    fetchActiveCommitments(supabase, memberId),
    fetchCalendarItems(supabase, memberId),
  ])

  // ---- Round 2 (parallel): co-attendance on every prickle this member has
  // attended (sister streaks), all attendance on the recent past prickles
  // (slot vibrancy, regulars, recent host punctuality, sister-likely), and
  // all-time hosted counts for the upcoming hosts. ----
  const myPrickleIds = [...new Set(myAttendance.map((r) => r.prickle_id))]
  const upcomingHostIds = [...new Set(upcoming.map((p) => p.hostId).filter((id): id is string => !!id))]
  type CoRecord = {
    member_id: string
    prickle_id: string
    join_time: string
    members: { name: string; display_name: string | null } | { name: string; display_name: string | null }[] | null
  }
  const [coAttendance, pastAttendance, hostedCounts] = await Promise.all([
    fetchInChunks(myPrickleIds, PRICKLE_ID_BATCH, (chunk) =>
      fetchAllPaginated<CoRecord>((offset) =>
        supabase
          .from("prickle_attendance")
          .select("member_id, prickle_id, join_time, members:attendance_member(name, display_name)")
          .in("prickle_id", chunk)
          .neq("member_id", memberId)
          .order("id")
          .range(offset, offset + BATCH_SIZE - 1)
      )
    ),
    upcoming.length > 0 ? fetchAttendanceForPrickles(supabase, pastPrickles.map((p) => p.id)) : Promise.resolve([]),
    fetchHostedCounts(supabase, upcomingHostIds, windowStart),
  ])

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
  // Lost prickle streaks: series where this member once had a real streak
  // (2+ weeks) but has since broken it.
  const lostStreakBySeries = new Map<string, number>()
  for (const s of prickleStreaks) {
    const key = seriesKeyFor(s.prickleTypeName, s.dayOfWeek, s.startHour)
    if (s.currentStreak > 0) activeStreakBySeries.set(key, s.currentStreak)
    else if (s.longestStreak >= 2) lostStreakBySeries.set(key, s.longestStreak)
  }

  // ---- Sister streaks: members with an active co-attendance streak. ----
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
  const activeSisters = sisterStreaks.filter((s) => s.currentStreak > 0 && isEstablishedSisterStreak(s))

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

    // Most-recent-first per series -- keep the last 2 occurrences of each.
    const seriesOccurrences = new Map<string, string[]>()
    for (let i = pastPrickles.length - 1; i >= 0; i--) {
      const p = pastPrickles[i]
      if (!seriesKeysInUpcoming.has(p.seriesKey)) continue
      const list = seriesOccurrences.get(p.seriesKey) ?? []
      if (list.length < 2) {
        list.push(p.id)
        seriesOccurrences.set(p.seriesKey, list)
      }
    }

    const sisterIds = new Set(activeSisters.map((s) => s.memberId))
    const attendedPrickleIdsByMember = new Map<string, Set<string>>()
    for (const a of pastAttendance) {
      if (!sisterIds.has(a.memberId)) continue
      const set = attendedPrickleIdsByMember.get(a.memberId) ?? new Set<string>()
      set.add(a.prickleId)
      attendedPrickleIdsByMember.set(a.memberId, set)
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

  // ---- Community recommendation signals (host experience, slot popularity,
  // regulars) -- the main ranking input when there's no personal signal. ----
  const past: PastPrickle[] = pastPrickles.map((p) => ({
    id: p.id,
    seriesKey: p.seriesKey,
    hostId: p.hostId,
    startTime: p.startTime,
  }))
  const slotVibrancy = computeSlotVibrancy(past, pastAttendance, memberId)
  const hostExperience = computeHostExperience(hostedCounts, past, pastAttendance)

  // ---- Commitments: which upcoming prickles are a week of an active
  // commitment. Matching candidates are every prickle already in hand --
  // upcoming, the 60-day past window, and every prickle this member attended
  // (so kept weeks older than the lookback still count). No extra query.
  // endTime only feeds the pending/missed split for past weeks, which isn't
  // shown here, so start time stands in for it. ----
  let commitmentByPrickleId = new Map<string, CommitmentSignal>()
  if (commitments.length > 0) {
    const candidates = new Map<string, SlotPrickle>()
    for (const p of [...pastPrickles, ...upcoming]) {
      candidates.set(p.id, { id: p.id, typeId: p.typeId, startTime: p.startTime, endTime: p.startTime })
    }
    for (const r of myAttendance) {
      if (!r.prickles || candidates.has(r.prickle_id)) continue
      const { start_time, type_id } = r.prickles
      candidates.set(r.prickle_id, { id: r.prickle_id, typeId: type_id, startTime: start_time, endTime: start_time })
    }
    commitmentByPrickleId = computeCommitmentSignals(
      commitments,
      [...candidates.values()],
      new Set(myAttendance.map((r) => r.prickle_id)),
      now
    )
  }

  return rankUpcomingPrickles({
    upcoming,
    memberId,
    now,
    timeZone,
    commitmentByPrickleId,
    calendarAddedByPrickleId: computeCalendarAdded(calendarItems, upcoming),
    activeStreakBySeries,
    lostStreakBySeries,
    sistersBySeries,
    highLikelihoodSistersBySeries,
    slotVibrancy,
    hostExperience,
  })
}
