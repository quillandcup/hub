export interface Streaks {
  currentStreak: number
  longestStreak: number
}

function weekIndex(isoTimestamp: string): number {
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000
  const timestamp = new Date(isoTimestamp).getTime()
  // Adjust to Monday boundary by finding the start of the calendar week
  const dateObj = new Date(timestamp)
  const dayOfWeek = dateObj.getUTCDay() // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const weekStart = new Date(dateObj)
  weekStart.setUTCDate(weekStart.getUTCDate() - daysToMonday)
  weekStart.setUTCHours(0, 0, 0, 0)
  return Math.floor(weekStart.getTime() / MS_PER_WEEK)
}

export function computeStreaks(joinTimes: string[], now: Date = new Date()): Streaks {
  if (joinTimes.length === 0) return { currentStreak: 0, longestStreak: 0 }

  const weeks = [...new Set(joinTimes.map(weekIndex))].sort((a, b) => a - b)

  let longestStreak = 1
  let run = 1
  for (let i = 1; i < weeks.length; i++) {
    if (weeks[i] === weeks[i - 1] + 1) {
      run++
      if (run > longestStreak) longestStreak = run
    } else {
      run = 1
    }
  }

  const currentWeek = weekIndex(now.toISOString())
  const lastAttendedWeek = weeks[weeks.length - 1]

  // Streak is broken if last attendance was more than 1 week ago
  if (lastAttendedWeek < currentWeek - 1) {
    return { currentStreak: 0, longestStreak }
  }

  let currentStreak = 1
  for (let i = weeks.length - 2; i >= 0; i--) {
    if (weeks[i] === weeks[i + 1] - 1) {
      currentStreak++
    } else {
      break
    }
  }

  return { currentStreak, longestStreak }
}
