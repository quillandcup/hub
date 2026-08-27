import { describe, it, expect } from 'vitest'
import { hostShortName, formatPrickleTitle } from '@/lib/formatters'

// ---------------------------------------------------------------------------
// hostShortName
// ---------------------------------------------------------------------------

describe('hostShortName', () => {
  it('formats a first + last name as "First L"', () => {
    expect(hostShortName('Jenn Peterson')).toBe('Jenn P')
  })

  it('uses the last word for the initial when there are middle names', () => {
    expect(hostShortName('Mary Jane Watson')).toBe('Mary W')
  })

  it('returns a single-word name unchanged', () => {
    expect(hostShortName('Cher')).toBe('Cher')
  })

  it('trims surrounding whitespace', () => {
    expect(hostShortName('  Jenn   Peterson  ')).toBe('Jenn P')
  })

  it('preserves the original casing of the name and initial', () => {
    expect(hostShortName('jenn peterson')).toBe('jenn p')
  })
})

// ---------------------------------------------------------------------------
// formatPrickleTitle
// ---------------------------------------------------------------------------

// Build local-time (not UTC) timestamps at noon so the computed weekday can't
// shift across a date boundary depending on the test runner's timezone.
const MONDAY = new Date(2026, 7, 24, 12, 0, 0).toISOString() // Aug 24, 2026
const TUESDAY = new Date(2026, 7, 25, 12, 0, 0).toISOString() // Aug 25, 2026

describe('formatPrickleTitle', () => {
  it('includes weekday, type name, and short host name', () => {
    const title = formatPrickleTitle({
      start_time: MONDAY,
      host: { name: 'Jenn Peterson' },
      prickle_types: { name: 'Progress Prickle' },
    })
    expect(title).toBe('Monday Progress Prickle with Jenn P')
  })

  it('omits "with {host}" when there is no host', () => {
    const title = formatPrickleTitle({
      start_time: MONDAY,
      host: null,
      prickle_types: { name: 'Progress Prickle' },
    })
    expect(title).toBe('Monday Progress Prickle')
  })

  it('falls back to "Prickle" when the type is missing', () => {
    const title = formatPrickleTitle({
      start_time: MONDAY,
      host: null,
      prickle_types: null,
    })
    expect(title).toBe('Monday Prickle')
  })

  it('unwraps host and prickle_types when Supabase returns them as arrays', () => {
    const title = formatPrickleTitle({
      start_time: TUESDAY,
      host: [{ name: 'Jenn Peterson' }],
      prickle_types: [{ name: 'Progress Prickle' }],
    })
    expect(title).toBe('Tuesday Progress Prickle with Jenn P')
  })

  it('handles an empty host array as no host', () => {
    const title = formatPrickleTitle({
      start_time: MONDAY,
      host: [],
      prickle_types: { name: 'Progress Prickle' },
    })
    expect(title).toBe('Monday Progress Prickle')
  })
})
