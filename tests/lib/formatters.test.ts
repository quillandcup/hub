import { describe, it, expect } from 'vitest'
import { hostShortName, formatPrickleTitle, formatDateInZone, formatDateOnly, formatDate, formatTime, formatDateTime, formatDateTimeRange } from '@/lib/formatters'

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
const MONDAY = '2026-08-24T16:00:00Z' // Mon Aug 24, 2026, noon Eastern
const TUESDAY = '2026-08-25T16:00:00Z' // Tue Aug 25, 2026, noon Eastern

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

// ---------------------------------------------------------------------------
// zone-aware formatters (never the host's zone)
// ---------------------------------------------------------------------------

describe('formatDate / formatTime / formatDateTime / formatDateTimeRange', () => {
  // 23:59 EDT on Jul 19 and 00:01 EDT on Jul 20, 2026
  const beforeMidnight = '2026-07-20T03:59:00Z'
  const afterMidnight = '2026-07-20T04:01:00Z'

  it('default to the org zone, either side of Eastern midnight', () => {
    expect(formatDate(beforeMidnight)).toBe('7/19/2026')
    expect(formatDate(afterMidnight)).toBe('7/20/2026')
    expect(formatTime(beforeMidnight)).toBe('11:59 PM')
    expect(formatDateTime(afterMidnight)).toBe('7/20/2026, 12:01 AM')
  })

  it('use the zone given', () => {
    expect(formatDate(beforeMidnight, 'Asia/Tokyo')).toBe('7/20/2026')
    expect(formatTime(beforeMidnight, 'Asia/Tokyo')).toBe('12:59 PM')
    expect(formatDateTime(beforeMidnight, 'America/Los_Angeles')).toBe('7/19/2026, 8:59 PM')
  })

  it('shows the date once for a range within one day in that zone', () => {
    expect(formatDateTimeRange('2026-07-19T14:00:00Z', '2026-07-19T15:00:00Z')).toBe(
      '7/19/2026, 10:00 AM - 11:00 AM'
    )
  })

  it('shows both dates for a range across Eastern midnight, but not in a zone where it is one day', () => {
    expect(formatDateTimeRange(beforeMidnight, afterMidnight)).toBe(
      '7/19/2026, 11:59 PM - 7/20/2026, 12:01 AM'
    )
    expect(formatDateTimeRange(beforeMidnight, afterMidnight, 'Asia/Tokyo')).toBe(
      '7/20/2026, 12:59 PM - 1:01 PM'
    )
  })

  it('reads the right wall-clock time on both sides of a daylight saving change', () => {
    // Spring forward 2026-03-08 02:00 EST -> 03:00 EDT
    expect(formatTime('2026-03-08T06:59:00Z')).toBe('1:59 AM')
    expect(formatTime('2026-03-08T07:00:00Z')).toBe('3:00 AM')
    // Fall back 2026-11-01 02:00 EDT -> 01:00 EST
    expect(formatTime('2026-11-01T05:59:00Z')).toBe('1:59 AM')
    expect(formatTime('2026-11-01T06:00:00Z')).toBe('1:00 AM')
  })

  it('formatPrickleTitle names the Eastern weekday', () => {
    expect(formatPrickleTitle({ start_time: '2026-07-20T03:59:00Z', prickle_types: { name: 'Writing' } })).toBe(
      'Sunday Writing'
    )
  })
})
