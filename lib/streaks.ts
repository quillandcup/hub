export interface Streaks {
  currentStreak: number
  longestStreak: number
}

export interface PrickleStreak extends Streaks {
  prickleTypeName: string
}

export interface SisterStreak extends Streaks {
  memberId: string
  memberName: string
}

function weekIndex(isoTimestamp: string): number {
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000
  const dateObj = new Date(isoTimestamp)
  const dayOfWeek = dateObj.getUTCDay()
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const weekStart = new Date(dateObj)
  weekStart.setUTCDate(weekStart.getUTCDate() - daysToMonday)
  weekStart.setUTCHours(0, 0, 0, 0)
  return Math.floor(weekStart.getTime() / MS_PER_WEEK)
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

export function computeStreaks(joinTimes: string[], now: Date = new Date()): Streaks {
  if (joinTimes.length === 0) return { currentStreak: 0, longestStreak: 0 }
  const weeks = [...new Set(joinTimes.map(weekIndex))].sort((a, b) => a - b)
  return computeStreaksFromWeeks(weeks, weekIndex(now.toISOString()))
}

export function computePrickleStreaks(
  records: { prickleTypeName: string; joinTime: string }[],
  now: Date = new Date()
): PrickleStreak[] {
  const grouped = new Map<string, string[]>()
  for (const r of records) {
    const group = grouped.get(r.prickleTypeName) ?? []
    group.push(r.joinTime)
    grouped.set(r.prickleTypeName, group)
  }
  return Array.from(grouped.entries()).map(([prickleTypeName, joinTimes]) => ({
    prickleTypeName,
    ...computeStreaks(joinTimes, now),
  }))
}

export function computeSisterStreaks(
  myAttendance: { prickleId: string; joinTime: string }[],
  coAttendance: { memberId: string; memberName: string; prickleId: string; joinTime: string }[],
  now: Date = new Date()
): SisterStreak[] {
  const currentWeek = weekIndex(now.toISOString())

  // Build map: prickleId -> Set<weekIndex> for current member
  const myPrickleWeeks = new Map<string, Set<number>>()
  for (const r of myAttendance) {
    const week = weekIndex(r.joinTime)
    const set = myPrickleWeeks.get(r.prickleId) ?? new Set()
    set.add(week)
    myPrickleWeeks.set(r.prickleId, set)
  }

  // For each co-member, collect weeks where they attended a prickle I also attended that week
  const sisterWeeks = new Map<string, { name: string; weeks: Set<number> }>()
  for (const r of coAttendance) {
    const week = weekIndex(r.joinTime)
    if (!myPrickleWeeks.get(r.prickleId)?.has(week)) continue
    const entry = sisterWeeks.get(r.memberId) ?? { name: r.memberName, weeks: new Set() }
    entry.weeks.add(week)
    sisterWeeks.set(r.memberId, entry)
  }

  return Array.from(sisterWeeks.entries()).map(([memberId, { name, weeks }]) => {
    const sortedWeeks = [...weeks].sort((a, b) => a - b)
    return {
      memberId,
      memberName: name,
      ...computeStreaksFromWeeks(sortedWeeks, currentWeek),
    }
  })
}
