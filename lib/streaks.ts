export interface Streaks {
  currentStreak: number
  longestStreak: number
}

export interface PrickleStreak extends Streaks {
  prickleTypeName: string
  dayOfWeek: string
  startHour: number
}

export interface SisterStreak extends Streaks {
  memberId: string
  memberName: string
  sharedPrickleIds: string[]
}

export interface RankedStreaks<T> {
  items: T[]
  total: number
}

/**
 * A streak only counts as an established "sister" relationship once it has
 * had at least one real 2-consecutive-week run of shared attendance. This is
 * the single source of truth for that threshold -- every feature that surfaces
 * "sisters" (Streaks page, Network page, dashboard sister-likely-attending
 * signal) must use it so they agree on who qualifies.
 */
export function isEstablishedSisterStreak(s: Streaks): boolean {
  return s.longestStreak >= 2
}

/**
 * Filters to streaks with at least a 2-week best run, ranks by current streak
 * (then longest streak) descending, and caps to `limit` rows. `total` reflects
 * the ranked-but-uncapped count, so callers can tell whether the list was truncated.
 */
export function rankStreaks<T extends Streaks>(streaks: T[], limit: number): RankedStreaks<T> {
  const ranked = streaks
    .filter(isEstablishedSisterStreak)
    .sort((a, b) => b.currentStreak - a.currentStreak || b.longestStreak - a.longestStreak)
  return { items: ranked.slice(0, limit), total: ranked.length }
}

function localCalendarDate(isoTimestamp: string, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(isoTimestamp))
  const year = Number(parts.find(p => p.type === 'year')!.value)
  const month = Number(parts.find(p => p.type === 'month')!.value)
  const day = Number(parts.find(p => p.type === 'day')!.value)
  return new Date(Date.UTC(year, month - 1, day))
}

function weekIndex(isoTimestamp: string, timeZone: string = 'UTC'): number {
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000
  const dateObj = localCalendarDate(isoTimestamp, timeZone)
  const dayOfWeek = dateObj.getUTCDay()
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  dateObj.setUTCDate(dateObj.getUTCDate() - daysToMonday)
  return Math.floor(dateObj.getTime() / MS_PER_WEEK)
}

function computeStreaksFromWeeks(sortedWeeks: number[], currentWeek: number): Streaks {
  if (sortedWeeks.length === 0) return { currentStreak: 0, longestStreak: 0 }

  let longestStreak = 0
  let run = 1
  for (let i = 1; i < sortedWeeks.length; i++) {
    if (sortedWeeks[i] === sortedWeeks[i - 1] + 1) {
      run++
    } else {
      longestStreak = Math.max(longestStreak, run)
      run = 1
    }
  }
  longestStreak = Math.max(longestStreak, run)

  const lastWeek = sortedWeeks[sortedWeeks.length - 1]
  if (lastWeek < currentWeek - 1) return { currentStreak: 0, longestStreak }

  let currentStreak = 1
  for (let i = sortedWeeks.length - 2; i >= 0; i--) {
    if (sortedWeeks[i] === sortedWeeks[i + 1] - 1) {
      currentStreak++
    } else {
      break
    }
  }

  return { currentStreak, longestStreak }
}

export function computeStreaks(
  joinTimes: string[],
  now: Date = new Date(),
  timeZone: string = 'UTC'
): Streaks {
  if (joinTimes.length === 0) return { currentStreak: 0, longestStreak: 0 }
  const weeks = [...new Set(joinTimes.map(t => weekIndex(t, timeZone)))].sort((a, b) => a - b)
  return computeStreaksFromWeeks(weeks, weekIndex(now.toISOString(), timeZone))
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function getLocalDayAndHour(date: Date, timeZone: string): { dayOfWeek: string; startHour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(date)
  const dayOfWeek = parts.find(p => p.type === 'weekday')?.value ?? DAY_NAMES[date.getUTCDay()]
  const hourStr = parts.find(p => p.type === 'hour')?.value ?? String(date.getUTCHours())
  return { dayOfWeek, startHour: parseInt(hourStr, 10) % 24 }
}

export function computePrickleStreaks(
  records: { prickleTypeName: string; joinTime: string; prickleStartTime: string }[],
  now: Date = new Date(),
  timeZone: string = 'UTC'
): PrickleStreak[] {
  type GroupEntry = { prickleTypeName: string; dayOfWeek: string; startHour: number; joinTimes: string[] }
  const grouped = new Map<string, GroupEntry>()
  for (const r of records) {
    const prickleDate = new Date(r.prickleStartTime)
    const { dayOfWeek, startHour } = getLocalDayAndHour(prickleDate, timeZone)
    const key = `${r.prickleTypeName}|${dayOfWeek}|${startHour}`
    if (!grouped.has(key)) {
      grouped.set(key, { prickleTypeName: r.prickleTypeName, dayOfWeek, startHour, joinTimes: [] })
    }
    grouped.get(key)!.joinTimes.push(r.joinTime)
  }
  return Array.from(grouped.values()).map(({ prickleTypeName, dayOfWeek, startHour, joinTimes }) => ({
    prickleTypeName,
    dayOfWeek,
    startHour,
    ...computeStreaks(joinTimes, now, timeZone),
  }))
}

export function computeSisterStreaks(
  myAttendance: { prickleId: string; joinTime: string }[],
  coAttendance: { memberId: string; memberName: string; prickleId: string; joinTime: string }[],
  now: Date = new Date(),
  timeZone: string = 'UTC'
): SisterStreak[] {
  const currentWeek = weekIndex(now.toISOString(), timeZone)

  // Build map: prickleId -> Set<weekIndex> for current member
  const myPrickleWeeks = new Map<string, Set<number>>()
  for (const r of myAttendance) {
    const week = weekIndex(r.joinTime, timeZone)
    const set = myPrickleWeeks.get(r.prickleId) ?? new Set()
    set.add(week)
    myPrickleWeeks.set(r.prickleId, set)
  }

  // For each co-member, collect weeks and prickle IDs where they attended a prickle I also attended that week
  const sisterWeeks = new Map<string, { name: string; weeks: Set<number>; prickleIds: Set<string> }>()
  for (const r of coAttendance) {
    const week = weekIndex(r.joinTime, timeZone)
    if (!myPrickleWeeks.get(r.prickleId)?.has(week)) continue
    const entry = sisterWeeks.get(r.memberId) ?? { name: r.memberName, weeks: new Set(), prickleIds: new Set() }
    entry.weeks.add(week)
    entry.prickleIds.add(r.prickleId)
    sisterWeeks.set(r.memberId, entry)
  }

  return Array.from(sisterWeeks.entries()).map(([memberId, { name, weeks, prickleIds }]) => {
    const sortedWeeks = [...weeks].sort((a, b) => a - b)
    return {
      memberId,
      memberName: name,
      sharedPrickleIds: [...prickleIds],
      ...computeStreaksFromWeeks(sortedWeeks, currentWeek),
    }
  })
}
