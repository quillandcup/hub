import { describe, it, expect } from 'vitest'
import { computeStreaks, computePrickleStreaks, computeSisterStreaks } from '@/lib/streaks'

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

  it('currentStreak is 1 when last attendance was exactly last week', () => {
    expect(
      computeStreaks([weeksAgo(1)], fixedNow)
    ).toEqual({ currentStreak: 1, longestStreak: 1 })
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

  it('buckets weeks by the member local date, not UTC date', () => {
    // Dec 29, 2025 06:00 UTC is Monday morning in UTC, but 22:00 PST the *prior* Sunday
    // night in Pacific time — a day-boundary crossing that pushes it into an earlier week bucket.
    const borderTimestamp = '2025-12-29T06:00:00Z'

    const utcResult = computeStreaks([borderTimestamp], fixedNow, 'UTC')
    const pacificResult = computeStreaks([borderTimestamp], fixedNow, 'America/Los_Angeles')

    // UTC sees this as Monday Dec 29 — exactly one week before the anchor week: streak still alive.
    expect(utcResult).toEqual({ currentStreak: 1, longestStreak: 1 })
    // Pacific sees this as Sunday Dec 28, which falls in the week starting Dec 22 —
    // two weeks before the anchor week, so the streak has already lapsed.
    expect(pacificResult).toEqual({ currentStreak: 0, longestStreak: 1 })
  })
})

// Fixed prickle start times (same day+hour = same series)
const SPRINT_START = '2026-01-05T05:00:00Z'  // Monday 5am UTC
const DEEP_START   = '2026-01-05T09:00:00Z'  // Monday 9am UTC
const WED_START    = '2026-01-07T14:00:00Z'  // Wednesday 2pm UTC

describe('computePrickleStreaks', () => {
  it('returns empty array for empty input', () => {
    expect(computePrickleStreaks([], fixedNow)).toEqual([])
  })

  it('computes per-type streaks independently', () => {
    const records = [
      { prickleTypeName: 'Morning Sprint', joinTime: weeksAgo(2), prickleStartTime: SPRINT_START },
      { prickleTypeName: 'Morning Sprint', joinTime: weeksAgo(1), prickleStartTime: SPRINT_START },
      { prickleTypeName: 'Morning Sprint', joinTime: weeksAgo(0), prickleStartTime: SPRINT_START },
      { prickleTypeName: 'Deep Work',      joinTime: weeksAgo(4), prickleStartTime: DEEP_START },
      { prickleTypeName: 'Deep Work',      joinTime: weeksAgo(3), prickleStartTime: DEEP_START },
    ]
    const result = computePrickleStreaks(records, fixedNow)
    const sprint = result.find(r => r.prickleTypeName === 'Morning Sprint')
    const deep = result.find(r => r.prickleTypeName === 'Deep Work')
    expect(sprint).toMatchObject({ prickleTypeName: 'Morning Sprint', dayOfWeek: 'Monday', startHour: 5, currentStreak: 3, longestStreak: 3 })
    expect(deep).toMatchObject({ prickleTypeName: 'Deep Work', dayOfWeek: 'Monday', startHour: 9, currentStreak: 0, longestStreak: 2 })
  })

  it('deduplicates multiple attendances of same series in same week', () => {
    const t1 = weeksAgo(0)
    const t2 = new Date(new Date(t1).getTime() + 2 * 24 * 60 * 60 * 1000).toISOString()
    const records = [
      { prickleTypeName: 'Morning Sprint', joinTime: t1, prickleStartTime: SPRINT_START },
      { prickleTypeName: 'Morning Sprint', joinTime: t2, prickleStartTime: SPRINT_START },
    ]
    const result = computePrickleStreaks(records, fixedNow)
    expect(result).toMatchObject([{ prickleTypeName: 'Morning Sprint', dayOfWeek: 'Monday', startHour: 5, currentStreak: 1, longestStreak: 1 }])
  })

  it('treats same type at different day as separate streaks', () => {
    const records = [
      { prickleTypeName: 'Morning Sprint', joinTime: weeksAgo(1), prickleStartTime: SPRINT_START },
      { prickleTypeName: 'Morning Sprint', joinTime: weeksAgo(0), prickleStartTime: SPRINT_START },
      { prickleTypeName: 'Morning Sprint', joinTime: weeksAgo(3), prickleStartTime: WED_START },
    ]
    const result = computePrickleStreaks(records, fixedNow)
    const monSprint = result.find(r => r.prickleTypeName === 'Morning Sprint' && r.dayOfWeek === 'Monday')
    const wedSprint = result.find(r => r.prickleTypeName === 'Morning Sprint' && r.dayOfWeek === 'Wednesday')
    expect(monSprint).toMatchObject({ currentStreak: 2, longestStreak: 2 })
    expect(wedSprint).toMatchObject({ currentStreak: 0, longestStreak: 1 })
  })

  it('treats same type on same day at different hours as separate streaks', () => {
    const AM_START = '2026-01-05T05:00:00Z'  // Monday 5am UTC
    const PM_START = '2026-01-05T15:00:00Z'  // Monday 3pm UTC
    const records = [
      { prickleTypeName: 'Sprint', joinTime: weeksAgo(0), prickleStartTime: AM_START },
      { prickleTypeName: 'Sprint', joinTime: weeksAgo(0), prickleStartTime: PM_START },
    ]
    const result = computePrickleStreaks(records, fixedNow)
    expect(result).toHaveLength(2)
    expect(result.find(r => r.startHour === 5)).toMatchObject({ currentStreak: 1 })
    expect(result.find(r => r.startHour === 15)).toMatchObject({ currentStreak: 1 })
  })
})

describe('computeSisterStreaks', () => {
  it('returns empty array when no co-attendance', () => {
    const myAttendance = [{ prickleId: 'p1', joinTime: weeksAgo(0) }]
    expect(computeSisterStreaks(myAttendance, [], fixedNow)).toEqual([])
  })

  it('counts weeks where both attended the same prickle', () => {
    const myAttendance = [
      { prickleId: 'p1', joinTime: weeksAgo(2) },
      { prickleId: 'p2', joinTime: weeksAgo(1) },
      { prickleId: 'p3', joinTime: weeksAgo(0) },
    ]
    const coAttendance = [
      { memberId: 'alice', memberName: 'Alice', prickleId: 'p1', joinTime: weeksAgo(2) },
      { memberId: 'alice', memberName: 'Alice', prickleId: 'p2', joinTime: weeksAgo(1) },
      { memberId: 'alice', memberName: 'Alice', prickleId: 'p3', joinTime: weeksAgo(0) },
    ]
    const result = computeSisterStreaks(myAttendance, coAttendance, fixedNow)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ memberId: 'alice', memberName: 'Alice', currentStreak: 3, longestStreak: 3 })
    expect(result[0].sharedPrickleIds).toEqual(expect.arrayContaining(['p1', 'p2', 'p3']))
    expect(result[0].sharedPrickleIds).toHaveLength(3)
  })

  it('does not count weeks where co-member attended a different prickle', () => {
    const myAttendance = [{ prickleId: 'p1', joinTime: weeksAgo(0) }]
    const coAttendance = [
      // Alice attended a different prickle the same week — not a shared prickle
      { memberId: 'alice', memberName: 'Alice', prickleId: 'p2', joinTime: weeksAgo(0) },
    ]
    const result = computeSisterStreaks(myAttendance, coAttendance, fixedNow)
    expect(result).toEqual([])
  })

  it('streak is broken when a week has no shared prickle', () => {
    // Shared weeks 3 and 1 ago, gap at week 2
    const myAttendance = [
      { prickleId: 'p1', joinTime: weeksAgo(3) },
      { prickleId: 'p2', joinTime: weeksAgo(1) },
      { prickleId: 'p3', joinTime: weeksAgo(0) },
    ]
    const coAttendance = [
      { memberId: 'alice', memberName: 'Alice', prickleId: 'p1', joinTime: weeksAgo(3) },
      { memberId: 'alice', memberName: 'Alice', prickleId: 'p2', joinTime: weeksAgo(1) },
      { memberId: 'alice', memberName: 'Alice', prickleId: 'p3', joinTime: weeksAgo(0) },
    ]
    const result = computeSisterStreaks(myAttendance, coAttendance, fixedNow)
    expect(result[0]).toMatchObject({ memberId: 'alice', memberName: 'Alice', currentStreak: 2, longestStreak: 2 })
    // All 3 prickles are shared even though p1 was in a broken streak
    expect(result[0].sharedPrickleIds).toEqual(expect.arrayContaining(['p1', 'p2', 'p3']))
  })

  it('tracks multiple co-members independently', () => {
    const myAttendance = [
      { prickleId: 'p1', joinTime: weeksAgo(1) },
      { prickleId: 'p2', joinTime: weeksAgo(0) },
    ]
    const coAttendance = [
      { memberId: 'alice', memberName: 'Alice', prickleId: 'p1', joinTime: weeksAgo(1) },
      { memberId: 'alice', memberName: 'Alice', prickleId: 'p2', joinTime: weeksAgo(0) },
      { memberId: 'bob', memberName: 'Bob', prickleId: 'p2', joinTime: weeksAgo(0) },
    ]
    const result = computeSisterStreaks(myAttendance, coAttendance, fixedNow)
    const alice = result.find(r => r.memberId === 'alice')
    const bob = result.find(r => r.memberId === 'bob')
    expect(alice).toMatchObject({ memberId: 'alice', memberName: 'Alice', currentStreak: 2, longestStreak: 2 })
    expect(alice?.sharedPrickleIds).toEqual(expect.arrayContaining(['p1', 'p2']))
    expect(bob).toMatchObject({ memberId: 'bob', memberName: 'Bob', currentStreak: 1, longestStreak: 1 })
    expect(bob?.sharedPrickleIds).toEqual(['p2'])
  })

  it('includes prickles from broken streaks in sharedPrickleIds', () => {
    // p1 was shared 4 weeks ago (broken streak), p2+p3 are the current streak
    const myAttendance = [
      { prickleId: 'p1', joinTime: weeksAgo(4) },
      { prickleId: 'p2', joinTime: weeksAgo(1) },
      { prickleId: 'p3', joinTime: weeksAgo(0) },
    ]
    const coAttendance = [
      { memberId: 'alice', memberName: 'Alice', prickleId: 'p1', joinTime: weeksAgo(4) },
      { memberId: 'alice', memberName: 'Alice', prickleId: 'p2', joinTime: weeksAgo(1) },
      { memberId: 'alice', memberName: 'Alice', prickleId: 'p3', joinTime: weeksAgo(0) },
    ]
    const result = computeSisterStreaks(myAttendance, coAttendance, fixedNow)
    expect(result[0]).toMatchObject({ currentStreak: 2, longestStreak: 2 })
    expect(result[0].sharedPrickleIds).toEqual(expect.arrayContaining(['p1', 'p2', 'p3']))
    expect(result[0].sharedPrickleIds).toHaveLength(3)
  })
})
