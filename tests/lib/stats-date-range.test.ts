import { describe, it, expect } from 'vitest'
import {
  MIN_DATE,
  todayDate,
  ytdStart,
  qtdStart,
  mtdStart,
  resolveDateRange,
} from '@/lib/stats-date-range'

// ---------------------------------------------------------------------------
// todayDate
// ---------------------------------------------------------------------------

describe('todayDate', () => {
  it('returns YYYY-MM-DD format', () => {
    expect(todayDate(new Date('2026-07-06T15:00:00Z'))).toBe('2026-07-06')
  })

  it('uses current date when no argument given', () => {
    expect(todayDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

// ---------------------------------------------------------------------------
// ytdStart
// ---------------------------------------------------------------------------

describe('ytdStart', () => {
  it('returns Jan 1 of the given year', () => {
    expect(ytdStart(new Date('2026-07-06'))).toBe('2026-01-01')
  })

  it('returns Jan 1 of next year when date is Dec 31', () => {
    expect(ytdStart(new Date('2026-12-31'))).toBe('2026-01-01')
  })

  it('returns Jan 1 of the correct year for future years', () => {
    expect(ytdStart(new Date('2027-03-15'))).toBe('2027-01-01')
  })

  it('returns Jan 1 when date is already Jan 1', () => {
    expect(ytdStart(new Date('2026-01-01T12:00:00'))).toBe('2026-01-01')
  })
})

// ---------------------------------------------------------------------------
// qtdStart
// ---------------------------------------------------------------------------

describe('qtdStart', () => {
  it('returns Jan 1 for Q1 (January)', () => {
    expect(qtdStart(new Date('2026-01-15'))).toBe('2026-01-01')
  })

  it('returns Jan 1 for Q1 (March)', () => {
    expect(qtdStart(new Date('2026-03-31'))).toBe('2026-01-01')
  })

  it('returns Apr 1 for Q2 (April)', () => {
    expect(qtdStart(new Date('2026-04-01T12:00:00'))).toBe('2026-04-01')
  })

  it('returns Apr 1 for Q2 (June)', () => {
    expect(qtdStart(new Date('2026-06-30'))).toBe('2026-04-01')
  })

  it('returns Jul 1 for Q3 (July)', () => {
    expect(qtdStart(new Date('2026-07-06'))).toBe('2026-07-01')
  })

  it('returns Jul 1 for Q3 (September)', () => {
    expect(qtdStart(new Date('2026-09-30'))).toBe('2026-07-01')
  })

  it('returns Oct 1 for Q4 (October)', () => {
    expect(qtdStart(new Date('2026-10-01T12:00:00'))).toBe('2026-10-01')
  })

  it('returns Oct 1 for Q4 (December)', () => {
    expect(qtdStart(new Date('2026-12-31'))).toBe('2026-10-01')
  })

  it('works across year boundaries', () => {
    expect(qtdStart(new Date('2027-02-14'))).toBe('2027-01-01')
  })
})

// ---------------------------------------------------------------------------
// mtdStart
// ---------------------------------------------------------------------------

describe('mtdStart', () => {
  it('returns the first of the current month', () => {
    expect(mtdStart(new Date('2026-07-06'))).toBe('2026-07-01')
  })

  it('returns the first when already on the first', () => {
    expect(mtdStart(new Date('2026-07-01T12:00:00'))).toBe('2026-07-01')
  })

  it('pads single-digit months', () => {
    expect(mtdStart(new Date('2026-01-31'))).toBe('2026-01-01')
  })

  it('handles December', () => {
    expect(mtdStart(new Date('2026-12-25'))).toBe('2026-12-01')
  })
})

// ---------------------------------------------------------------------------
// resolveDateRange
// ---------------------------------------------------------------------------

describe('resolveDateRange', () => {
  const JUL_6 = new Date('2026-07-06T12:00:00Z')

  describe('defaults', () => {
    it('defaults from to YTD start when no params given', () => {
      const { from } = resolveDateRange({}, JUL_6)
      expect(from).toBe('2026-01-01')
    })

    it('defaults to to today when no params given', () => {
      const { to } = resolveDateRange({}, JUL_6)
      expect(to).toBe('2026-07-06')
    })

    it('YTD start in a future year is that year\'s Jan 1', () => {
      const { from } = resolveDateRange({}, new Date('2027-05-20'))
      expect(from).toBe('2027-01-01')
    })
  })

  describe('valid params', () => {
    it('uses a valid from param as-is', () => {
      const { from } = resolveDateRange({ from: '2026-03-01' }, JUL_6)
      expect(from).toBe('2026-03-01')
    })

    it('uses a valid to param as-is', () => {
      const { to } = resolveDateRange({ to: '2026-06-30' }, JUL_6)
      expect(to).toBe('2026-06-30')
    })

    it('accepts MIN_DATE itself as from', () => {
      const { from } = resolveDateRange({ from: MIN_DATE }, JUL_6)
      expect(from).toBe('2026-01-01')
    })
  })

  describe('clamping invalid params', () => {
    it('clamps from before MIN_DATE to defaultFrom', () => {
      const { from } = resolveDateRange({ from: '2025-12-01' }, JUL_6)
      expect(from).toBe('2026-01-01') // YTD default, not 2025-12-01
    })

    it('clamps to after today to today', () => {
      const { to } = resolveDateRange({ to: '2030-01-01' }, JUL_6)
      expect(to).toBe('2026-07-06')
    })

    it('ignores empty string from param', () => {
      const { from } = resolveDateRange({ from: '' }, JUL_6)
      expect(from).toBe('2026-01-01')
    })
  })

  describe('since / until', () => {
    it('appends T00:00:00Z to from for since', () => {
      const { since } = resolveDateRange({ from: '2026-03-01', to: '2026-03-31' }, JUL_6)
      expect(since).toBe('2026-03-01T00:00:00Z')
    })

    it('appends T23:59:59Z to to for until', () => {
      const { until } = resolveDateRange({ from: '2026-03-01', to: '2026-03-31' }, JUL_6)
      expect(until).toBe('2026-03-31T23:59:59Z')
    })
  })
})
