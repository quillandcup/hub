import { describe, it, expect } from 'vitest'
import {
  etHour,
  etDate,
  etDow,
  etIsWeekday,
  computeTopHosts,
  computeTopAttendees,
  computePrickleTypes,
  computeHourCoverage,
  computeDayOfWeek,
  computeHeroStats,
  type PrickleRow,
  type AttRow,
} from '@/lib/community-stats'

// Known timestamps for ET timezone assertions
// Winter (EST, UTC-5): Jan 5 2026 is a Monday
const MON_7AM_ET  = '2026-01-05T12:00:00Z' // 7am EST
const MON_10AM_ET = '2026-01-05T15:00:00Z' // 10am EST
const SAT_7AM_ET  = '2026-01-03T12:00:00Z' // 7am EST Saturday
const SUN_7AM_ET  = '2026-01-04T12:00:00Z' // 7am EST Sunday
// DST edge: midnight ET = 5am UTC in winter
const MIDNIGHT_ET = '2026-01-01T05:00:00Z' // 2026-01-01 00:00 EST
const PRE_MIDNIGHT = '2026-01-01T04:59:00Z' // 2025-12-31 23:59 EST
// Summer (EDT, UTC-4): Jul 6 2026 is a Monday
const MON_7AM_ET_SUMMER = '2026-07-06T11:00:00Z' // 7am EDT

function makePrickle(id: string, start_time: string, hostName?: string, typeName?: string, normalized?: string): PrickleRow {
  return {
    id,
    start_time,
    members: hostName ? { name: hostName } : null,
    prickle_types: typeName ? { name: typeName, normalized_name: normalized ?? typeName.toLowerCase() } : null,
  }
}

function makeAtt(memberId: string, prickleId: string, memberName?: string, durationHours = 1): AttRow {
  const join = new Date('2026-01-05T12:00:00Z')
  const leave = new Date(join.getTime() + durationHours * 60 * 60 * 1000)
  return {
    member_id: memberId,
    prickle_id: prickleId,
    join_time: join.toISOString(),
    leave_time: leave.toISOString(),
    members: memberName ? { name: memberName } : null,
  }
}

// ---------------------------------------------------------------------------
// Timezone helpers
// ---------------------------------------------------------------------------

describe('etHour', () => {
  it('returns 7 for 7am ET in winter', () => {
    expect(etHour(MON_7AM_ET)).toBe(7)
  })

  it('returns 10 for 10am ET in winter', () => {
    expect(etHour(MON_10AM_ET)).toBe(10)
  })

  it('returns 0 for midnight ET (not 24)', () => {
    expect(etHour(MIDNIGHT_ET)).toBe(0)
  })

  it('returns 7 for 7am ET in summer (DST)', () => {
    expect(etHour(MON_7AM_ET_SUMMER)).toBe(7)
  })
})

describe('etDate', () => {
  it('returns ET date for a daytime timestamp', () => {
    expect(etDate(MON_10AM_ET)).toBe('2026-01-05')
  })

  it('returns previous calendar day when UTC date is ahead of ET date', () => {
    // 2026-01-01T04:59Z = Dec 31 2025 in ET (UTC-5 winter)
    expect(etDate(PRE_MIDNIGHT)).toBe('2025-12-31')
  })

  it('returns the ET date not the UTC date at midnight ET', () => {
    // 2026-01-01T05:00Z = Jan 1 2026 00:00 ET
    expect(etDate(MIDNIGHT_ET)).toBe('2026-01-01')
  })
})

describe('etDow', () => {
  it('identifies Monday', () => {
    expect(etDow(MON_7AM_ET)).toBe('Monday')
  })

  it('identifies Saturday', () => {
    expect(etDow(SAT_7AM_ET)).toBe('Saturday')
  })

  it('identifies Sunday', () => {
    expect(etDow(SUN_7AM_ET)).toBe('Sunday')
  })
})

describe('etIsWeekday', () => {
  it('returns true for Monday', () => {
    expect(etIsWeekday(MON_7AM_ET)).toBe(true)
  })

  it('returns false for Saturday', () => {
    expect(etIsWeekday(SAT_7AM_ET)).toBe(false)
  })

  it('returns false for Sunday', () => {
    expect(etIsWeekday(SUN_7AM_ET)).toBe(false)
  })

  it('returns true for summer weekday', () => {
    expect(etIsWeekday(MON_7AM_ET_SUMMER)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// computeTopHosts
// ---------------------------------------------------------------------------

describe('computeTopHosts', () => {
  it('returns empty array for no prickles', () => {
    expect(computeTopHosts([])).toEqual([])
  })

  it('excludes prickles with no host', () => {
    const prickles = [makePrickle('p1', MON_7AM_ET)]
    expect(computeTopHosts(prickles)).toEqual([])
  })

  it('counts multiple prickles by the same host', () => {
    const prickles = [
      makePrickle('p1', MON_7AM_ET, 'Alice'),
      makePrickle('p2', MON_10AM_ET, 'Alice'),
      makePrickle('p3', MON_7AM_ET, 'Bob'),
    ]
    const result = computeTopHosts(prickles)
    expect(result[0]).toEqual({ name: 'Alice', count: 2 })
    expect(result[1]).toEqual({ name: 'Bob', count: 1 })
  })

  it('sorts by count descending', () => {
    const prickles = [
      makePrickle('p1', MON_7AM_ET, 'Bob'),
      makePrickle('p2', MON_7AM_ET, 'Alice'),
      makePrickle('p3', MON_7AM_ET, 'Alice'),
      makePrickle('p4', MON_7AM_ET, 'Alice'),
    ]
    expect(computeTopHosts(prickles)[0].name).toBe('Alice')
  })

  it('limits results to the given limit', () => {
    const prickles = Array.from({ length: 15 }, (_, i) =>
      makePrickle(`p${i}`, MON_7AM_ET, `Host ${i}`)
    )
    expect(computeTopHosts(prickles, 5)).toHaveLength(5)
    expect(computeTopHosts(prickles, 10)).toHaveLength(10)
  })
})

// ---------------------------------------------------------------------------
// computeTopAttendees
// ---------------------------------------------------------------------------

describe('computeTopAttendees', () => {
  it('returns empty array for no attendance', () => {
    expect(computeTopAttendees([])).toEqual([])
  })

  it('excludes attendance records with no member name', () => {
    const att = [makeAtt('m1', 'p1')]
    expect(computeTopAttendees(att)).toEqual([])
  })

  it('counts unique prickles attended (not total attendance records)', () => {
    // m1 has 3 records for 2 prickles (left+rejoined p1)
    const att = [
      makeAtt('m1', 'p1', 'Alice'),
      makeAtt('m1', 'p1', 'Alice'),
      makeAtt('m1', 'p2', 'Alice'),
    ]
    const result = computeTopAttendees(att)
    expect(result[0]).toEqual({ name: 'Alice', count: 2 })
  })

  it('sorts by unique prickle count descending', () => {
    const att = [
      makeAtt('m1', 'p1', 'Alice'),
      makeAtt('m2', 'p1', 'Bob'),
      makeAtt('m2', 'p2', 'Bob'),
      makeAtt('m2', 'p3', 'Bob'),
    ]
    const result = computeTopAttendees(att)
    expect(result[0].name).toBe('Bob')
    expect(result[0].count).toBe(3)
    expect(result[1].name).toBe('Alice')
    expect(result[1].count).toBe(1)
  })

  it('limits to given limit', () => {
    const att = Array.from({ length: 15 }, (_, i) =>
      makeAtt(`m${i}`, `p${i}`, `Member ${i}`)
    )
    expect(computeTopAttendees(att, 5)).toHaveLength(5)
  })
})

// ---------------------------------------------------------------------------
// computePrickleTypes
// ---------------------------------------------------------------------------

describe('computePrickleTypes', () => {
  it('returns empty array when no prickles', () => {
    expect(computePrickleTypes([], new Map())).toEqual([])
  })

  it('excludes progress prickles', () => {
    const prickles = Array.from({ length: 10 }, (_, i) =>
      makePrickle(`p${i}`, MON_7AM_ET, undefined, 'Progress Prickle', 'progress')
    )
    expect(computePrickleTypes(prickles, new Map())).toEqual([])
  })

  it('excludes types below minSessions threshold', () => {
    const prickles = [
      makePrickle('p1', MON_7AM_ET, undefined, 'Rare Type', 'rare'),
      makePrickle('p2', MON_7AM_ET, undefined, 'Rare Type', 'rare'),
    ]
    expect(computePrickleTypes(prickles, new Map(), 5)).toEqual([])
  })

  it('computes avgAttendance correctly', () => {
    const prickles = Array.from({ length: 5 }, (_, i) =>
      makePrickle(`p${i}`, MON_7AM_ET, undefined, 'Heads Down', 'heads-down')
    )
    const attByPrickle = new Map([
      ['p0', 3],
      ['p1', 4],
      ['p2', 3],
      ['p3', 4],
      ['p4', 6], // total 20 / 5 = 4.0
    ])
    const result = computePrickleTypes(prickles, attByPrickle, 5)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Heads Down')
    expect(result[0].sessions).toBe(5)
    expect(result[0].totalAttendance).toBe(20)
    expect(result[0].avgAttendance).toBe(4.0)
  })

  it('rounds avgAttendance to 1 decimal', () => {
    const prickles = Array.from({ length: 6 }, (_, i) =>
      makePrickle(`p${i}`, MON_7AM_ET, undefined, 'Sprint', 'sprint')
    )
    const attByPrickle = new Map([
      ['p0', 2], ['p1', 2], ['p2', 2], ['p3', 2], ['p4', 2], ['p5', 3],
      // total 13 / 6 = 2.1666... → 2.2
    ])
    const result = computePrickleTypes(prickles, attByPrickle, 5)
    expect(result[0].avgAttendance).toBe(2.2)
  })

  it('sorts by avgAttendance descending', () => {
    const typeA = Array.from({ length: 5 }, (_, i) =>
      makePrickle(`a${i}`, MON_7AM_ET, undefined, 'Type A', 'type-a')
    )
    const typeB = Array.from({ length: 5 }, (_, i) =>
      makePrickle(`b${i}`, MON_7AM_ET, undefined, 'Type B', 'type-b')
    )
    const attByPrickle = new Map<string, number>([
      ...typeA.map((p): [string, number] => [p.id, 10]),
      ...typeB.map((p): [string, number] => [p.id, 2]),
    ])
    const result = computePrickleTypes([...typeA, ...typeB], attByPrickle, 5)
    expect(result[0].name).toBe('Type A')
    expect(result[1].name).toBe('Type B')
  })

  it('counts prickles with no attendance as zero (not excluded)', () => {
    const prickles = Array.from({ length: 5 }, (_, i) =>
      makePrickle(`p${i}`, MON_7AM_ET, undefined, 'Open Table', 'open-table')
    )
    const result = computePrickleTypes(prickles, new Map(), 5)
    expect(result[0].avgAttendance).toBe(0)
    expect(result[0].sessions).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// computeHourCoverage
// ---------------------------------------------------------------------------

describe('computeHourCoverage', () => {
  it('returns 24 entries for empty input (all zero)', () => {
    const result = computeHourCoverage([])
    expect(result).toHaveLength(24)
    expect(result.every(e => e.pct === 0)).toBe(true)
    expect(result.map(e => e.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i))
  })

  it('computes 100% when every day has a prickle at that hour', () => {
    // Two prickles on two different days, both at 7am ET
    const tue7am = '2026-01-06T12:00:00Z' // Tuesday 7am ET
    const prickles = [
      makePrickle('p1', MON_7AM_ET),
      makePrickle('p2', tue7am),
    ]
    const result = computeHourCoverage(prickles)
    expect(result[7].pct).toBe(100)
  })

  it('computes 50% when half of days have a prickle at that hour', () => {
    // Day 1: 7am and 10am. Day 2: 10am only.
    const tue10am = '2026-01-06T15:00:00Z'
    const prickles = [
      makePrickle('p1', MON_7AM_ET),
      makePrickle('p2', MON_10AM_ET),
      makePrickle('p3', tue10am),
    ]
    const result = computeHourCoverage(prickles)
    // 2 total days; hour 7 covered on 1 day → 50%
    expect(result[7].pct).toBe(50)
    // hour 10 covered on both days → 100%
    expect(result[10].pct).toBe(100)
  })

  it('multiple prickles on the same day at the same hour count as one day', () => {
    const prickles = [
      makePrickle('p1', MON_7AM_ET),
      makePrickle('p2', MON_7AM_ET), // same day, same hour
    ]
    const result = computeHourCoverage(prickles)
    // Still only 1 day total, 1 day with hour 7 → 100%
    expect(result[7].pct).toBe(100)
  })

  it('handles midnight correctly (hour 0, not 24)', () => {
    const prickles = [makePrickle('p1', MIDNIGHT_ET)]
    const result = computeHourCoverage(prickles)
    expect(result[0].pct).toBe(100)
    expect(result[24]).toBeUndefined()
  })

  // Clock-specific: outer ring = AM (hours 0–11), inner ring = PM (hours 12–23)

  it('always produces exactly 12 AM entries and 12 PM entries', () => {
    const prickles = [makePrickle('p1', MON_7AM_ET)]
    const result = computeHourCoverage(prickles)
    expect(result.filter(e => e.hour < 12)).toHaveLength(12)
    expect(result.filter(e => e.hour >= 12)).toHaveLength(12)
  })

  it('tracks AM and PM hours at the same clock position independently', () => {
    // 7pm EST Jan 5 = 2026-01-06T00:00Z (UTC-5); same ET date as MON_7AM_ET
    const mon7pm_et = '2026-01-06T00:00:00Z' // hour 19, ET date 2026-01-05
    const prickles = [makePrickle('p1', mon7pm_et)]
    const result = computeHourCoverage(prickles)
    expect(result[19].pct).toBe(100) // 7pm → hour 19 covered
    expect(result[7].pct).toBe(0)    // hour 7 (7am) unaffected by a 7pm prickle
  })

  it('PM prickle maps to hour 12–23, not 0–11', () => {
    // 3pm ET in winter = 20:00 UTC
    const mon3pm = '2026-01-05T20:00:00Z'
    const prickles = [makePrickle('p1', mon3pm)]
    const result = computeHourCoverage(prickles)
    expect(result[15].pct).toBe(100) // hour 15 = 3pm
    expect(result[3].pct).toBe(0)    // hour 3 (3am) unaffected
  })

  it('late night prickle maps to hour 23', () => {
    // 11:30pm ET in winter = 04:30 UTC next day
    const late_night = '2026-01-06T04:30:00Z' // 11:30pm ET Jan 5
    const prickles = [makePrickle('p1', late_night)]
    const result = computeHourCoverage(prickles)
    expect(result[23].pct).toBe(100)
    expect(result[11].pct).toBe(0) // 11am unaffected
  })
})

// ---------------------------------------------------------------------------
// computeDayOfWeek
// ---------------------------------------------------------------------------

describe('computeDayOfWeek', () => {
  it('returns 7 entries in Sun–Sat order', () => {
    const result = computeDayOfWeek([])
    expect(result).toHaveLength(7)
    expect(result.map(e => e.day)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
  })

  it('returns all zeros for empty input', () => {
    const result = computeDayOfWeek([])
    expect(result.every(e => e.count === 0)).toBe(true)
  })

  it('correctly assigns Monday and Saturday', () => {
    const prickles = [
      makePrickle('p1', MON_7AM_ET),
      makePrickle('p2', MON_7AM_ET),
      makePrickle('p3', SAT_7AM_ET),
    ]
    const result = computeDayOfWeek(prickles)
    const mon = result.find(e => e.day === 'Mon')!
    const sat = result.find(e => e.day === 'Sat')!
    const sun = result.find(e => e.day === 'Sun')!
    expect(mon.count).toBe(2)
    expect(sat.count).toBe(1)
    expect(sun.count).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// computeHeroStats
// ---------------------------------------------------------------------------

describe('computeHeroStats', () => {
  it('returns zeros for empty input', () => {
    const result = computeHeroStats([], [])
    expect(result).toEqual({ totalHours: 0, uniqueAttendees: 0, weekdayCoverage: 0 })
  })

  it('sums attendance durations into totalHours', () => {
    const att = [
      makeAtt('m1', 'p1', 'Alice', 2),
      makeAtt('m2', 'p1', 'Bob', 1.5),
    ]
    const result = computeHeroStats([], att)
    expect(result.totalHours).toBe(4) // Math.round(3.5) = 4? Wait 2+1.5=3.5 → rounds to 4
  })

  it('rounds totalHours to whole number', () => {
    const att = [makeAtt('m1', 'p1', 'Alice', 1.4)]
    expect(computeHeroStats([], att).totalHours).toBe(1)
  })

  it('counts unique attendees by member_id', () => {
    // m1 has two records, but is one unique attendee
    const att = [
      makeAtt('m1', 'p1', 'Alice'),
      makeAtt('m1', 'p2', 'Alice'),
      makeAtt('m2', 'p3', 'Bob'),
    ]
    expect(computeHeroStats([], att).uniqueAttendees).toBe(2)
  })

  it('computes 100% weekdayCoverage when every weekday has a 7am prickle', () => {
    const prickles = [
      makePrickle('p1', MON_7AM_ET), // Mon 7am
    ]
    const result = computeHeroStats(prickles, [])
    expect(result.weekdayCoverage).toBe(100)
  })

  it('excludes weekends from weekdayCoverage', () => {
    // Weekend 7am prickle — should not affect weekday coverage denominator
    const prickles = [makePrickle('p1', SAT_7AM_ET)]
    const result = computeHeroStats(prickles, [])
    // No weekday prickles → 0% (denominator is 0 weekday days)
    expect(result.weekdayCoverage).toBe(0)
  })

  it('computes correct partial weekdayCoverage', () => {
    // 2 weekdays, only 1 has a 7am prickle
    const tue10am = '2026-01-06T15:00:00Z' // Tuesday 10am ET (no 7am)
    const prickles = [
      makePrickle('p1', MON_7AM_ET),  // Mon has 7am → covered
      makePrickle('p2', tue10am),      // Tue has 10am but no 7am → not covered
    ]
    const result = computeHeroStats(prickles, [])
    expect(result.weekdayCoverage).toBe(50)
  })
})
