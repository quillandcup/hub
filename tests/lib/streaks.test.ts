import { describe, it, expect } from 'vitest'
import { computeStreaks } from '@/lib/streaks'

// Helpers: build ISO timestamps N weeks apart from a fixed anchor
const ANCHOR_MS = new Date('2026-01-05T12:00:00Z').getTime() // a Monday
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000

// "today" in our test universe — the anchor date itself
const fixedNow = new Date(ANCHOR_MS)

function weeksAgo(n: number): string {
  return new Date(ANCHOR_MS - n * MS_PER_WEEK).toISOString()
}

describe('computeStreaks', () => {
  it('returns zeros for empty input', () => {
    expect(computeStreaks([], fixedNow)).toEqual({ currentStreak: 0, longestStreak: 0 })
  })

  it('returns 1/1 for a single attendance this week', () => {
    expect(computeStreaks([weeksAgo(0)], fixedNow)).toEqual({ currentStreak: 1, longestStreak: 1 })
  })

  it('deduplicates multiple attendances in the same week', () => {
    // Two timestamps in the same week
    const t1 = weeksAgo(0)
    const t2 = new Date(new Date(t1).getTime() + 3 * 24 * 60 * 60 * 1000).toISOString()
    expect(computeStreaks([t1, t2], fixedNow)).toEqual({ currentStreak: 1, longestStreak: 1 })
  })

  it('counts consecutive weeks as a streak', () => {
    expect(
      computeStreaks([weeksAgo(2), weeksAgo(1), weeksAgo(0)], fixedNow)
    ).toEqual({ currentStreak: 3, longestStreak: 3 })
  })

  it('currentStreak is 0 when last attendance was 2+ weeks ago', () => {
    // Attended 4 weeks ago, 3 weeks ago, 2 weeks ago — but no recent attendance
    expect(
      computeStreaks([weeksAgo(4), weeksAgo(3), weeksAgo(2)], fixedNow)
    ).toEqual({ currentStreak: 0, longestStreak: 3 })
  })

  it('currentStreak stops at the gap from the most recent week', () => {
    // Streak of 3 (weeks 5,4,3 ago), gap, then streak of 2 (weeks 1,0 ago)
    expect(
      computeStreaks([weeksAgo(5), weeksAgo(4), weeksAgo(3), weeksAgo(1), weeksAgo(0)], fixedNow)
    ).toEqual({ currentStreak: 2, longestStreak: 3 })
  })

  it('longestStreak finds the max run', () => {
    // Streak of 4 (weeks 8–5 ago), gap, week 2 alone, gap, isolated (week 0)
    expect(
      computeStreaks([
        weeksAgo(8), weeksAgo(7), weeksAgo(6), weeksAgo(5),
        weeksAgo(2),
        weeksAgo(0),
      ], fixedNow)
    ).toEqual({ currentStreak: 1, longestStreak: 4 })
  })
})
