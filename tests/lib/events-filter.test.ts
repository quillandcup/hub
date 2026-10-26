import { describe, it, expect } from 'vitest'
import {
  parseEventFilter,
  primaryFilterOf,
  eventMatchesFilter,
  showsSpecialtyPrickles,
  groupEvents,
  countUpcoming,
  localDateString,
} from '@/lib/events-filter'

const TODAY = '2026-09-26'

const EVENTS = [
  { id: 'a', event_type: 'in_person_retreat', starts_at: '2026-11-01', ends_at: '2026-11-04' },
  { id: 'b', event_type: 'virtual_retreat', starts_at: '2026-10-10', ends_at: '2026-10-11' },
  { id: 'c', event_type: 'other', starts_at: '2026-12-01', ends_at: '2026-12-01' },
  { id: 'd', event_type: 'in_person_retreat', starts_at: '2026-03-01', ends_at: '2026-03-05' },
  { id: 'e', event_type: 'virtual_retreat', starts_at: '2026-06-01', ends_at: '2026-06-02' },
  // In progress: started before today, ends today -> still upcoming
  { id: 'f', event_type: 'other', starts_at: '2026-09-25', ends_at: '2026-09-26' },
]

const ids = (rows: { id: string }[]) => rows.map((r) => r.id)

describe('parseEventFilter', () => {
  it('accepts allowlisted values', () => {
    expect(parseEventFilter('retreats')).toBe('retreats')
    expect(parseEventFilter('virtual_retreat')).toBe('virtual_retreat')
    expect(parseEventFilter('specialty')).toBe('specialty')
  })

  it('maps the old educational filter in saved links to specialty', () => {
    expect(parseEventFilter('educational')).toBe('specialty')
  })

  it('falls back to all for missing or unknown values', () => {
    expect(parseEventFilter(undefined)).toBe('all')
    expect(parseEventFilter(null)).toBe('all')
    expect(parseEventFilter('')).toBe('all')
    expect(parseEventFilter('bogus')).toBe('all')
    expect(parseEventFilter('__proto__')).toBe('all')
  })

  it('uses the first value of a repeated param', () => {
    expect(parseEventFilter(['other', 'retreats'])).toBe('other')
  })
})

describe('primaryFilterOf', () => {
  it('maps retreat sub-filters to retreats', () => {
    expect(primaryFilterOf('in_person_retreat')).toBe('retreats')
    expect(primaryFilterOf('virtual_retreat')).toBe('retreats')
    expect(primaryFilterOf('retreats')).toBe('retreats')
    expect(primaryFilterOf('specialty')).toBe('specialty')
    expect(primaryFilterOf('all')).toBe('all')
  })
})

describe('eventMatchesFilter', () => {
  it('matches by type', () => {
    expect(eventMatchesFilter('in_person_retreat', 'retreats')).toBe(true)
    expect(eventMatchesFilter('virtual_retreat', 'retreats')).toBe(true)
    expect(eventMatchesFilter('other', 'retreats')).toBe(false)
    expect(eventMatchesFilter('virtual_retreat', 'in_person_retreat')).toBe(false)
    expect(eventMatchesFilter('other', 'other')).toBe(true)
    expect(eventMatchesFilter('other', 'all')).toBe(true)
  })

  it('never matches events for the educational filter', () => {
    expect(eventMatchesFilter('in_person_retreat', 'specialty')).toBe(false)
    expect(eventMatchesFilter('other', 'specialty')).toBe(false)
  })
})

describe('showsSpecialtyPrickles', () => {
  it('only for all and educational', () => {
    expect(showsSpecialtyPrickles('all')).toBe(true)
    expect(showsSpecialtyPrickles('specialty')).toBe(true)
    expect(showsSpecialtyPrickles('retreats')).toBe(false)
    expect(showsSpecialtyPrickles('other')).toBe(false)
  })
})

describe('groupEvents', () => {
  it('splits upcoming (soonest first) from past (most recent first)', () => {
    const { upcoming, past } = groupEvents(EVENTS, 'all', TODAY)
    expect(ids(upcoming)).toEqual(['f', 'b', 'a', 'c'])
    expect(ids(past)).toEqual(['e', 'd'])
  })

  it('treats an event ending today as upcoming', () => {
    const { upcoming } = groupEvents(EVENTS, 'other', TODAY)
    expect(ids(upcoming)).toEqual(['f', 'c'])
  })

  it('filters retreats and retreat formats', () => {
    expect(ids(groupEvents(EVENTS, 'retreats', TODAY).upcoming)).toEqual(['b', 'a'])
    expect(ids(groupEvents(EVENTS, 'retreats', TODAY).past)).toEqual(['e', 'd'])
    expect(ids(groupEvents(EVENTS, 'in_person_retreat', TODAY).upcoming)).toEqual(['a'])
    expect(ids(groupEvents(EVENTS, 'virtual_retreat', TODAY).past)).toEqual(['e'])
  })

  it('returns no events for the educational filter', () => {
    expect(groupEvents(EVENTS, 'specialty', TODAY)).toEqual({ upcoming: [], past: [] })
  })

  it('does not mutate its input', () => {
    const copy = [...EVENTS]
    groupEvents(EVENTS, 'all', TODAY)
    expect(EVENTS).toEqual(copy)
  })
})

describe('countUpcoming', () => {
  it('counts upcoming events per filter plus specialty prickles', () => {
    expect(countUpcoming(EVENTS, 3, TODAY)).toEqual({
      all: 7,
      retreats: 2,
      in_person_retreat: 1,
      virtual_retreat: 1,
      specialty: 3,
      other: 2,
    })
  })
})

describe('localDateString', () => {
  it('formats the date in the given timezone', () => {
    const lateEvening = new Date('2026-09-27T02:00:00Z') // 10pm Sep 26 in New York
    expect(localDateString(lateEvening, 'America/New_York')).toBe('2026-09-26')
    expect(localDateString(lateEvening, 'UTC')).toBe('2026-09-27')
  })
})
