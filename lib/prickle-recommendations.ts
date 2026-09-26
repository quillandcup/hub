import { computeHostPunctuality } from "@/lib/hosting-stats"
import { hostShortName } from "@/lib/formatters"

// Community-level "is this a good prickle to try?" signals for the Upcoming
// list -- used to recommend strong sessions to members who don't (yet) have
// personal signals like hosting, streaks, or sister attendance. All functions
// here are pure; lib/upcoming-prickles.ts does the fetching.
//
// Three signals, each normalized to [0, 1]:
//   - Host experience: how many sessions the host has run (all-time), scaled
//     by their recent show-up / on-time record.
//   - Popularity: typical attendance at this recurring slot in the lookback.
//   - Regulars: how many frequent attendees ("regulars") typically show up to
//     this slot -- the experienced Hedgies who make a session feel welcoming.

/** How far back we look for slot attendance / regulars / recent host punctuality. Matches the
 * sister-streak lookback in lib/upcoming-prickles.ts so a single past-prickle fetch serves both. */
export const RECOMMENDATION_LOOKBACK_DAYS = 60

/** A member who attended at least this many distinct prickles in the lookback (~60 days) counts as
 * a regular -- roughly "most weeks". */
export const REGULAR_MIN_DISTINCT_PRICKLES = 6

// Normalization caps: at or above these, the component score saturates at 1.
const HOST_EXPERIENCE_CAP = 20
const POPULARITY_CAP = 8
const REGULARS_CAP = 4

// Weights for the combined recommendation score (sum to 1).
export const RECOMMENDATION_WEIGHTS = { host: 0.4, popularity: 0.3, regulars: 0.3 } as const

// Needed before we trust a host's recent punctuality record over a neutral prior.
const MIN_RECENT_HOSTED_FOR_RELIABILITY = 2
const NEUTRAL_RELIABILITY = 0.85

// Badge thresholds.
export const EXPERIENCED_HOST_MIN_HOSTED = 10
const EXPERIENCED_HOST_MIN_SHOW_UP_RATE = 0.8
export const POPULAR_MIN_AVG_ATTENDANCE = 5
export const REGULARS_MIN_AVG = 3
/** Need at least this many past occurrences before a slot's averages mean anything. */
const MIN_OCCURRENCES_FOR_SLOT_BADGE = 2

// Diversity / time-proximity knobs for ordering recommendations.
const SAME_DAY_PENALTY = 0.15
const SAME_SERIES_PENALTY = 0.25
const PER_DAY_AWAY_PENALTY = 0.01
const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface PastPrickle {
  id: string
  seriesKey: string
  hostId: string | null
  startTime: string
}

export interface PastAttendance {
  prickleId: string
  memberId: string
  joinTime: string
}

export interface SlotVibrancy {
  /** Past occurrences of this slot in the lookback. */
  occurrences: number
  /** Average distinct attendees per past occurrence. */
  avgAttendance: number
  /** Average distinct regulars per past occurrence. */
  avgRegulars: number
}

export interface HostExperience {
  /** All-time count of prickles this member has hosted that have already started. */
  hostedCount: number
  /** Hosted prickles in the lookback window (for punctuality). */
  recentHosted: number
  /** ...of which the host actually showed up. */
  recentShowedUp: number
  /** ...of which the host joined within the late threshold. */
  recentOnTime: number
}

/** Members who attended at least `minDistinct` distinct prickles in `attendance` (multiple rows
 * per member/prickle are expected -- leave/rejoin -- so count distinct prickle IDs). */
export function computeRegularMemberIds(
  attendance: PastAttendance[],
  minDistinct: number = REGULAR_MIN_DISTINCT_PRICKLES,
): Set<string> {
  const prickleIdsByMember = new Map<string, Set<string>>()
  for (const a of attendance) {
    const set = prickleIdsByMember.get(a.memberId) ?? new Set<string>()
    set.add(a.prickleId)
    prickleIdsByMember.set(a.memberId, set)
  }
  const regulars = new Set<string>()
  for (const [memberId, ids] of prickleIdsByMember) {
    if (ids.size >= minDistinct) regulars.add(memberId)
  }
  return regulars
}

/** Distinct attendee IDs per prickle. */
export function buildAttendeesByPrickle(attendance: PastAttendance[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const a of attendance) {
    const set = map.get(a.prickleId) ?? new Set<string>()
    set.add(a.memberId)
    map.set(a.prickleId, set)
  }
  return map
}

/** Per recurring slot: average attendance and average regulars across its past occurrences.
 * `viewerId` is excluded so a member's own attendance doesn't inflate their recommendations. */
export function computeSlotVibrancy(
  pastPrickles: PastPrickle[],
  attendance: PastAttendance[],
  viewerId: string | null = null,
): Map<string, SlotVibrancy> {
  const attendeesByPrickle = buildAttendeesByPrickle(attendance)
  const regulars = computeRegularMemberIds(attendance)

  const totals = new Map<string, { occurrences: number; attendees: number; regulars: number }>()
  for (const p of pastPrickles) {
    const entry = totals.get(p.seriesKey) ?? { occurrences: 0, attendees: 0, regulars: 0 }
    entry.occurrences += 1
    for (const memberId of attendeesByPrickle.get(p.id) ?? []) {
      if (memberId === viewerId) continue
      entry.attendees += 1
      if (regulars.has(memberId)) entry.regulars += 1
    }
    totals.set(p.seriesKey, entry)
  }

  const result = new Map<string, SlotVibrancy>()
  for (const [key, t] of totals) {
    result.set(key, {
      occurrences: t.occurrences,
      avgAttendance: t.attendees / t.occurrences,
      avgRegulars: t.regulars / t.occurrences,
    })
  }
  return result
}

/** Combines all-time hosted counts with recent punctuality (from the lookback's past prickles and
 * the host's own earliest join per prickle -- hosts can leave/rejoin). */
export function computeHostExperience(
  hostedCounts: Map<string, number>,
  pastPrickles: PastPrickle[],
  attendance: PastAttendance[],
): Map<string, HostExperience> {
  const earliestJoin = new Map<string, string>() // `${prickleId}|${memberId}` -> join
  for (const a of attendance) {
    const key = `${a.prickleId}|${a.memberId}`
    const existing = earliestJoin.get(key)
    if (!existing || a.joinTime < existing) earliestJoin.set(key, a.joinTime)
  }

  const result = new Map<string, HostExperience>()
  const entryFor = (hostId: string): HostExperience => {
    let e = result.get(hostId)
    if (!e) {
      e = { hostedCount: hostedCounts.get(hostId) ?? 0, recentHosted: 0, recentShowedUp: 0, recentOnTime: 0 }
      result.set(hostId, e)
    }
    return e
  }
  for (const hostId of hostedCounts.keys()) entryFor(hostId)

  for (const p of pastPrickles) {
    if (!p.hostId) continue
    const e = entryFor(p.hostId)
    e.recentHosted += 1
    const punctuality = computeHostPunctuality(p.startTime, earliestJoin.get(`${p.id}|${p.hostId}`) ?? null)
    if (punctuality !== "missing") e.recentShowedUp += 1
    if (punctuality === "on_time") e.recentOnTime += 1
  }
  return result
}

function hostReliability(h: HostExperience): number {
  if (h.recentHosted < MIN_RECENT_HOSTED_FOR_RELIABILITY) return NEUTRAL_RELIABILITY
  const showUpRate = h.recentShowedUp / h.recentHosted
  const onTimeRate = h.recentShowedUp > 0 ? h.recentOnTime / h.recentShowedUp : 0
  // Showing up matters most; punctuality is a softer secondary factor.
  return showUpRate * (0.7 + 0.3 * onTimeRate)
}

export function hostScore(h: HostExperience | null | undefined): number {
  if (!h) return 0
  return (Math.min(h.hostedCount, HOST_EXPERIENCE_CAP) / HOST_EXPERIENCE_CAP) * hostReliability(h)
}

/** Combined community recommendation score in [0, 1]. Brand-new slots and brand-new/unknown hosts
 * score low; established hosts running well-attended, regular-heavy slots score high. */
export function scoreRecommendation(
  host: HostExperience | null | undefined,
  slot: SlotVibrancy | null | undefined,
): number {
  const popularity = slot ? Math.min(slot.avgAttendance, POPULARITY_CAP) / POPULARITY_CAP : 0
  const regulars = slot ? Math.min(slot.avgRegulars, REGULARS_CAP) / REGULARS_CAP : 0
  return (
    RECOMMENDATION_WEIGHTS.host * hostScore(host) +
    RECOMMENDATION_WEIGHTS.popularity * popularity +
    RECOMMENDATION_WEIGHTS.regulars * regulars
  )
}

export type RecommendationReasonKind = "experiencedHost" | "popular" | "regulars"

export interface RecommendationReason {
  kind: RecommendationReasonKind
  tooltip: string[]
}

/** Friendly, badge-worthy explanations -- only emitted when a signal is clearly strong, so the
 * badges stay meaningful rather than appearing on every row. */
export function recommendationReasons(input: {
  hostName: string | null
  host: HostExperience | null | undefined
  slot: SlotVibrancy | null | undefined
  /** Skip the host badge when the viewer is the host ("You're hosting" already says it). */
  viewerIsHost: boolean
}): RecommendationReason[] {
  const { hostName, host, slot, viewerIsHost } = input
  const reasons: RecommendationReason[] = []

  if (!viewerIsHost && host && hostName && host.hostedCount >= EXPERIENCED_HOST_MIN_HOSTED) {
    // Too few recent sessions to judge reliability -> don't hold it against them.
    const reliable =
      host.recentHosted < MIN_RECENT_HOSTED_FOR_RELIABILITY ||
      host.recentShowedUp / host.recentHosted >= EXPERIENCED_HOST_MIN_SHOW_UP_RATE
    if (reliable) {
      const tooltip = [`${hostShortName(hostName)} has hosted ${host.hostedCount} sessions`]
      if (
        host.recentShowedUp >= MIN_RECENT_HOSTED_FOR_RELIABILITY &&
        host.recentOnTime / host.recentShowedUp >= EXPERIENCED_HOST_MIN_SHOW_UP_RATE
      ) {
        tooltip.push("Reliably there on time")
      }
      reasons.push({ kind: "experiencedHost", tooltip })
    }
  }

  if (slot && slot.occurrences >= MIN_OCCURRENCES_FOR_SLOT_BADGE) {
    if (slot.avgAttendance >= POPULAR_MIN_AVG_ATTENDANCE) {
      reasons.push({ kind: "popular", tooltip: [`Usually about ${Math.round(slot.avgAttendance)} writers`] })
    }
    if (slot.avgRegulars >= REGULARS_MIN_AVG) {
      const n = Math.round(slot.avgRegulars)
      reasons.push({ kind: "regulars", tooltip: [`Usually ${n} regulars — Hedgies who come most weeks`] })
    }
  }

  return reasons
}

export interface DiversityCandidate {
  id: string
  startTime: string
  /** Local calendar date in the viewer's timezone, e.g. "2026-09-26". */
  dayKey: string
  seriesKey: string
  score: number
}

/**
 * Greedy ordering that balances recommendation quality with spread: each pick is the candidate
 * with the best score after penalties for (a) days already represented, (b) slots already picked
 * (a weekly slot shouldn't take two of the top spots), and (c) a gentle per-day-away decay so
 * soon prickles aren't buried. Ties go to the earlier prickle. `seed` pre-loads day/series counts
 * from items already placed above these (e.g. personal-signal picks).
 */
export function orderWithDiversity<T extends DiversityCandidate>(
  candidates: T[],
  now: Date,
  seed: { dayKey: string; seriesKey: string }[] = [],
): T[] {
  const dayCounts = new Map<string, number>()
  const seriesCounts = new Map<string, number>()
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
  for (const s of seed) {
    bump(dayCounts, s.dayKey)
    bump(seriesCounts, s.seriesKey)
  }

  const nowMs = now.getTime()
  const remaining = candidates.map((c) => ({
    c,
    startMs: new Date(c.startTime).getTime(),
    base: c.score - PER_DAY_AWAY_PENALTY * Math.max(0, (new Date(c.startTime).getTime() - nowMs) / MS_PER_DAY),
  }))
  const ordered: T[] = []

  while (remaining.length > 0) {
    let bestIdx = 0
    let bestValue = -Infinity
    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i]
      const value =
        r.base -
        SAME_DAY_PENALTY * (dayCounts.get(r.c.dayKey) ?? 0) -
        SAME_SERIES_PENALTY * (seriesCounts.get(r.c.seriesKey) ?? 0)
      const best = remaining[bestIdx]
      if (value > bestValue + 1e-9 || (Math.abs(value - bestValue) <= 1e-9 && r.startMs < best.startMs)) {
        bestValue = value
        bestIdx = i
      }
    }
    const [picked] = remaining.splice(bestIdx, 1)
    ordered.push(picked.c)
    bump(dayCounts, picked.c.dayKey)
    bump(seriesCounts, picked.c.seriesKey)
  }
  return ordered
}
