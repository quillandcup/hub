import { describe, it, expect } from 'vitest'
import {
  eventTier,
  localDateString,
  prickleEventKind,
} from '@/lib/events-filter'

describe('eventTier', () => {
  it('puts retreats, workshops and parties among the special events', () => {
    for (const t of ['in_person_retreat', 'virtual_retreat', 'workshop', 'social', 'book_launch', 'other', 'unknown']) expect(eventTier({ event_type: t })).toBe('special')
  })

  it('makes anything that takes a sign-up a special event, whatever its kind', () => {
    expect(eventTier({ event_type: 'educational', registration: 'required' })).toBe('special')
    expect(eventTier({ event_type: 'session', registration: 'application' })).toBe('special')
    expect(eventTier({ event_type: 'educational', registration: 'none' })).toBe('educational')
    expect(eventTier({ event_type: 'session', registration: null })).toBe('session')
  })

  it('keeps educational and sessions apart', () => {
    expect(eventTier({ event_type: 'educational' })).toBe('educational')
    expect(eventTier({ event_type: 'session' })).toBe('session')
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
