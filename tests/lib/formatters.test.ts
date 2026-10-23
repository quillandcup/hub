import { describe, it, expect } from 'vitest'
import { hostShortName, formatPrickleTitle, formatDateInZone, formatDateOnly } from '@/lib/formatters'

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
  it('uses its own title when it has one', () => {
    expect(formatPrickleTitle({ title: 'Query Letters Webinar', start_time: MONDAY, host: { name: 'Jenn Peterson' }, prickle_types: { name: 'Educational Prickle' } }))
      .toBe('Query Letters Webinar')
  })

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

// ---------------------------------------------------------------------------
// formatOrgDate / formatDateOnly: the same text on the server (UTC) and in any browser
// ---------------------------------------------------------------------------

describe('formatDateInZone', () => {
  const NY = 'America/New_York'

  it('uses the zone\'s calendar day on either side of midnight', () => {
    expect(formatDateInZone('2024-03-01T04:30:00Z', NY)).toBe('2/29/2024') // 11:30 pm Eastern
    expect(formatDateInZone('2024-03-01T05:30:00Z', NY)).toBe('3/1/2024') // 12:30 am Eastern
  })

  it('differs by the viewer\'s zone for the same instant', () => {
    expect(formatDateInZone('2024-03-01T20:00:00Z', 'Pacific/Auckland')).toBe('3/2/2024')
    expect(formatDateInZone('2024-03-01T20:00:00Z', 'America/Los_Angeles')).toBe('3/1/2024')
  })

  it('follows daylight saving time', () => {
    expect(formatDateInZone('2024-03-10T04:59:00Z', NY)).toBe('3/9/2024')
    expect(formatDateInZone('2024-11-03T03:59:00Z', NY)).toBe('11/2/2024') // still EDT, fall-back day
    expect(formatDateInZone('2024-11-03T05:00:00Z', NY)).toBe('11/3/2024')
  })

  it('accepts a Date', () => {
    expect(formatDateInZone(new Date('2024-07-19T12:00:00Z'), NY)).toBe('7/19/2024')
  })
})

describe('formatDateOnly', () => {
  it('prints the stored date without shifting it', () => {
    expect(formatDateOnly('2023-02-15')).toBe('2/15/2023')
    expect(formatDateOnly('2024-01-01')).toBe('1/1/2024')
  })

  it('uses the first ten characters of a timestamp', () => {
    expect(formatDateOnly('2023-02-15T00:00:00+00:00')).toBe('2/15/2023')
  })
})
