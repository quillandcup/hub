import { describe, it, expect } from 'vitest'
import {
  parseEventFilter,
  eventTier,
  tierMatchesFilter,
  groupEvents,
  countUpcoming,
  localDateString,
  prickleEventKind,
} from '@/lib/events-filter'

const TODAY = '2026-09-26'

const EVENTS = [
  { id: 'a', event_type: 'in_person_retreat', starts_at: '2026-11-01', ends_at: '2026-11-04' },
  { id: 'b', event_type: 'virtual_retreat', starts_at: '2026-10-10', ends_at: '2026-10-11' },
  { id: 'c', event_type: 'social', starts_at: '2026-12-01', ends_at: '2026-12-01' },
  { id: 'd', event_type: 'in_person_retreat', starts_at: '2026-03-01', ends_at: '2026-03-05' },
  { id: 'e', event_type: 'educational', starts_at: '2026-06-01', ends_at: '2026-06-02' },
  // In progress: started before today, ends today -> still upcoming
  { id: 'f', event_type: 'session', starts_at: '2026-09-25', ends_at: '2026-09-26' },
  { id: 'g', event_type: 'educational', starts_at: '2026-10-20', ends_at: '2026-10-20' },
]

const ids = (rows: { id: string }[]) => rows.map((r) => r.id)

describe('parseEventFilter', () => {
  it('accepts allowlisted values', () => {
    for (const id of ['big', 'educational', 'events', 'sessions']) expect(parseEventFilter(id)).toBe(id)
  })

  it('falls back to all for missing or unknown values, including the old ones', () => {
    for (const bad of [undefined, null, '', 'bogus', '__proto__', 'retreats', 'prickles', 'other']) expect(parseEventFilter(bad)).toBe('all')
  })

  it('uses the first value of a repeated param', () => {
    expect(parseEventFilter(['sessions', 'big'])).toBe('sessions')
  })
})

describe('eventTier', () => {
  it('puts retreats and workshops among the big events', () => {
    for (const t of ['in_person_retreat', 'virtual_retreat', 'workshop']) expect(eventTier({ event_type: t })).toBe('big')
  })

  it('makes anything that takes a sign-up a big event, whatever its kind', () => {
    expect(eventTier({ event_type: 'educational', registration: 'required' })).toBe('big')
    expect(eventTier({ event_type: 'session', registration: 'application' })).toBe('big')
    expect(eventTier({ event_type: 'educational', registration: 'none' })).toBe('educational')
    expect(eventTier({ event_type: 'session', registration: null })).toBe('session')
  })

  it('keeps educational, sessions and everything else apart', () => {
    expect(eventTier({ event_type: 'educational' })).toBe('educational')
    expect(eventTier({ event_type: 'session' })).toBe('session')
    for (const t of ['social', 'book_launch', 'other', 'unknown']) expect(eventTier({ event_type: t })).toBe('event')
  })
})

describe('tierMatchesFilter', () => {
  it('matches each tier with its filter, and all with everything', () => {
    expect(tierMatchesFilter('big', 'big')).toBe(true)
    expect(tierMatchesFilter('educational', 'educational')).toBe(true)
    expect(tierMatchesFilter('event', 'events')).toBe(true)
    expect(tierMatchesFilter('session', 'sessions')).toBe(true)
    expect(tierMatchesFilter('session', 'events')).toBe(false)
    expect(tierMatchesFilter('big', 'educational')).toBe(false)
    expect(tierMatchesFilter('session', 'all')).toBe(true)
  })
})

describe('groupEvents', () => {
  it('splits upcoming (soonest first) from past (most recent first)', () => {
    const { upcoming, past } = groupEvents(EVENTS, 'all', TODAY)
    expect(ids(upcoming)).toEqual(['f', 'b', 'g', 'a', 'c'])
    expect(ids(past)).toEqual(['e', 'd'])
  })

  it('treats an event ending today as upcoming', () => {
    expect(ids(groupEvents(EVENTS, 'sessions', TODAY).upcoming)).toEqual(['f'])
  })

  it('filters by tier', () => {
    expect(ids(groupEvents(EVENTS, 'big', TODAY).upcoming)).toEqual(['b', 'a'])
    expect(ids(groupEvents(EVENTS, 'big', TODAY).past)).toEqual(['d'])
    expect(ids(groupEvents(EVENTS, 'educational', TODAY).upcoming)).toEqual(['g'])
    expect(ids(groupEvents(EVENTS, 'educational', TODAY).past)).toEqual(['e'])
    expect(ids(groupEvents(EVENTS, 'events', TODAY).upcoming)).toEqual(['c'])
  })

  it('does not mutate its input', () => {
    const copy = [...EVENTS]
    groupEvents(EVENTS, 'all', TODAY)
    expect(EVENTS).toEqual(copy)
  })
})

describe('countUpcoming', () => {
  it('counts upcoming events per filter, adding the featured prickles to sessions and all', () => {
    expect(countUpcoming(EVENTS, 3, TODAY)).toEqual({ all: 8, big: 2, educational: 1, events: 1, sessions: 4 })
  })
})

describe('localDateString', () => {
  it('formats the date in the given timezone', () => {
    const lateEvening = new Date('2026-09-27T02:00:00Z') // 10pm Sep 26 in New York
    expect(localDateString(lateEvening, 'America/New_York')).toBe('2026-09-26')
    expect(localDateString(lateEvening, 'UTC')).toBe('2026-09-27')
  })
})

describe('prickleEventKind', () => {
  it('makes the educational type\'s events educational and every other prickle\'s a session', () => {
    expect(prickleEventKind('educational')).toBe('educational')
    expect(prickleEventKind('pitch')).toBe('session')
    expect(prickleEventKind(null)).toBe('session')
  })
})
