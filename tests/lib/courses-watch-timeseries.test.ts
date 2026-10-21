import { describe, expect, it } from 'vitest'
import type { PlaySession } from '@/lib/courses/watch-stats'
import {
  bucketLabel,
  bucketStart,
  computeTimeSeries,
  effectiveGranularity,
  formatMetricValue,
  isValidDate,
  localDate,
  MAX_POINTS,
  parseTimeSeriesQuery,
  pointCount,
  resolveRange,
} from '@/lib/courses/watch-timeseries'

const TZ = 'America/New_York'
// Tuesday 20 October 2026, 3pm in New York.
const NOW = new Date('2026-10-20T19:00:00Z')

describe('localDate', () => {
  it("is the calendar date in the organisation's timezone, not UTC", () => {
    // 01:30 UTC on the 7th is still the evening of the 6th in New York.
    expect(localDate('2026-10-07T01:30:00Z', TZ)).toBe('2026-10-06')
    expect(localDate('2026-10-07T01:30:00Z', 'UTC')).toBe('2026-10-07')
  })
})

describe('isValidDate', () => {
  it.each([['2026-10-20', true], ['2026-02-30', false], ['2026-13-01', false], ['20261020', false], ['', false], [null, false], [undefined, false]])('%s -> %s', (value, expected) => {
    expect(isValidDate(value as string | null | undefined)).toBe(expected)
  })
})

describe('resolveRange', () => {
  const at = (preset: Parameters<typeof resolveRange>[0], options?: Parameters<typeof resolveRange>[3]) => resolveRange(preset, NOW, TZ, options)

  it('resolves each preset as of today in the organisation timezone', () => {
    expect(at('today')).toEqual({ from: '2026-10-20', to: '2026-10-20' })
    expect(at('7d')).toEqual({ from: '2026-10-14', to: '2026-10-20' })
    expect(at('30d')).toEqual({ from: '2026-09-21', to: '2026-10-20' })
    expect(at('this_month')).toEqual({ from: '2026-10-01', to: '2026-10-20' })
    expect(at('last_month')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(at('this_quarter')).toEqual({ from: '2026-10-01', to: '2026-10-20' })
    expect(at('last_quarter')).toEqual({ from: '2026-07-01', to: '2026-09-30' })
    expect(at('this_year')).toEqual({ from: '2026-01-01', to: '2026-10-20' })
    expect(at('12m')).toEqual({ from: '2025-10-21', to: '2026-10-20' })
  })

  it('crosses year ends and short months', () => {
    const jan = resolveRange('last_month', new Date('2027-01-15T12:00:00Z'), TZ)
    expect(jan).toEqual({ from: '2026-12-01', to: '2026-12-31' })
    expect(resolveRange('last_month', new Date('2026-03-10T12:00:00Z'), TZ)).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(resolveRange('last_quarter', new Date('2027-02-10T12:00:00Z'), TZ)).toEqual({ from: '2026-10-01', to: '2026-12-31' })
  })

  it('uses the local day at the edge of midnight UTC', () => {
    // 02:00 UTC on the 21st is 10pm on the 20th in New York.
    expect(resolveRange('today', new Date('2026-10-21T02:00:00Z'), TZ)).toEqual({ from: '2026-10-20', to: '2026-10-20' })
  })

  it('runs "all time" from the first recorded activity, or the last 30 days when there is none', () => {
    expect(at('all', { earliest: '2026-10-05' })).toEqual({ from: '2026-10-05', to: '2026-10-20' })
    expect(at('all')).toEqual({ from: '2026-09-21', to: '2026-10-20' })
    expect(at('all', { earliest: '2030-01-01' })).toEqual({ from: '2026-09-21', to: '2026-10-20' })
  })

  it('takes a valid custom range, and falls back to the last 30 days for anything else', () => {
    expect(at('custom', { custom: { from: '2026-08-01', to: '2026-08-15' } })).toEqual({ from: '2026-08-01', to: '2026-08-15' })
    expect(at('custom', { custom: { from: '2026-08-15', to: '2026-08-01' } })).toEqual({ from: '2026-09-21', to: '2026-10-20' })
    expect(at('custom', { custom: { from: 'junk', to: '2026-08-01' } })).toEqual({ from: '2026-09-21', to: '2026-10-20' })
    expect(at('custom', { custom: { from: '1999-01-01', to: '2026-08-01' } })).toEqual({ from: '2026-09-21', to: '2026-10-20' })
    expect(at('custom')).toEqual({ from: '2026-09-21', to: '2026-10-20' })
  })
})

describe('buckets', () => {
  it('starts a week on Sunday and a month on the 1st', () => {
    // 2026-10-20 is a Tuesday.
    expect(bucketStart('2026-10-20', 'day')).toBe('2026-10-20')
    expect(bucketStart('2026-10-20', 'week')).toBe('2026-10-18')
    expect(bucketStart('2026-10-18', 'week')).toBe('2026-10-18')
    expect(bucketStart('2026-10-17', 'week')).toBe('2026-10-11')
    expect(bucketStart('2026-10-20', 'month')).toBe('2026-10-01')
  })

  it('counts the points of a range, a partial first and last bucket included', () => {
    const range = { from: '2026-10-14', to: '2026-10-20' }
    expect(pointCount(range, 'day')).toBe(7)
    expect(pointCount(range, 'week')).toBe(2)
    expect(pointCount({ from: '2026-08-15', to: '2026-10-20' }, 'month')).toBe(3)
    expect(pointCount({ from: '2026-12-20', to: '2027-01-05' }, 'month')).toBe(2)
  })

  it('shows a daily range too long to draw by week instead', () => {
    expect(effectiveGranularity({ from: '2026-01-01', to: '2026-10-20' }, 'day')).toBe('day')
    expect(pointCount({ from: '2025-01-01', to: '2026-10-20' }, 'day')).toBeGreaterThan(MAX_POINTS)
    expect(effectiveGranularity({ from: '2025-01-01', to: '2026-10-20' }, 'day')).toBe('week')
    expect(effectiveGranularity({ from: '2025-01-01', to: '2026-10-20' }, 'month')).toBe('month')
  })

  it('labels a point by its first day, or by its month', () => {
    expect(bucketLabel('2026-10-06', 'day')).toBe('Oct 6')
    expect(bucketLabel('2026-10-04', 'week')).toBe('Oct 4')
    expect(bucketLabel('2026-10-01', 'month')).toBe('Oct 2026')
  })
})

const session = (over: Partial<PlaySession> & { sessionId: string; memberId: string; startedAt: string | null }): PlaySession => ({
  userAgent: null,
  played: true,
  watchedSeconds: 60,
  coveredFraction: 0.1,
  intervals: [],
  ...over,
})

describe('computeTimeSeries', () => {
  const range = { from: '2026-10-05', to: '2026-10-07' }
  const base = { granularity: 'day' as const, range, timeZone: TZ, durationSeconds: 600 }
  // Monday: Ann plays 5 minutes, Bea only opens the lesson. Tuesday: Ann plays 10 minutes twice (two visits), Cara opens it.
  const sessions = [
    session({ sessionId: 'a1', memberId: 'ann', startedAt: '2026-10-05T15:00:00Z', watchedSeconds: 300 }),
    session({ sessionId: 'b1', memberId: 'bea', startedAt: '2026-10-05T16:00:00Z', played: false, watchedSeconds: 0 }),
    session({ sessionId: 'a2', memberId: 'ann', startedAt: '2026-10-06T14:00:00Z', watchedSeconds: 600 }),
    session({ sessionId: 'a3', memberId: 'ann', startedAt: '2026-10-06T20:00:00Z', watchedSeconds: 600 }),
    session({ sessionId: 'c1', memberId: 'cara', startedAt: '2026-10-06T21:00:00Z', played: false, watchedSeconds: 0 }),
  ]

  it('has a point for every day in the range, zero where nothing happened', () => {
    const series = computeTimeSeries(sessions, { ...base, metric: 'total_plays' })
    expect(series.points.map((p) => [p.start, p.value])).toEqual([['2026-10-05', 1], ['2026-10-06', 2], ['2026-10-07', 0]])
    expect(series.points.map((p) => p.label)).toEqual(['Oct 5', 'Oct 6', 'Oct 7'])
  })

  it('counts total plays, unique plays and unique viewers by what each means', () => {
    const plays = computeTimeSeries(sessions, { ...base, metric: 'total_plays' })
    expect(plays.total).toBe(3)
    // Ann played twice on the 6th but is one unique play there, and one over the whole range.
    const unique = computeTimeSeries(sessions, { ...base, metric: 'unique_plays' })
    expect(unique.points.map((p) => p.value)).toEqual([1, 1, 0])
    expect(unique.total).toBe(1)
    // Viewers include those who only opened it: Ann and Bea on the 5th, Ann and Cara on the 6th, three people in all.
    const viewers = computeTimeSeries(sessions, { ...base, metric: 'unique_viewers' })
    expect(viewers.points.map((p) => p.value)).toEqual([2, 2, 0])
    expect(viewers.total).toBe(3)
  })

  it('gives play rate, engagement rate and hours watched, with their units', () => {
    const rate = computeTimeSeries(sessions, { ...base, metric: 'play_rate' })
    expect(rate.unit).toBe('percent')
    expect(rate.points.map((p) => p.value)).toEqual([0.5, 2 / 3, 0])
    expect(rate.total).toBeCloseTo(3 / 5)

    const engagement = computeTimeSeries(sessions, { ...base, metric: 'engagement_rate' })
    // The 5th: 300s over (1 play x 600s). The 6th: 1200s over (2 plays x 600s).
    expect(engagement.points.map((p) => p.value)).toEqual([0.5, 1, 0])
    expect(engagement.total).toBeCloseTo(1500 / (3 * 600))

    const hours = computeTimeSeries(sessions, { ...base, metric: 'hours_watched' })
    expect(hours.unit).toBe('hours')
    expect(hours.points[1].value).toBeCloseTo(1200 / 3600)
    expect(hours.total).toBeCloseTo(1500 / 3600)
  })

  it('attributes a visit to the local day it began in, not the UTC day', () => {
    const late = [session({ sessionId: 'x', memberId: 'ann', startedAt: '2026-10-07T02:00:00Z' })]
    const series = computeTimeSeries(late, { ...base, metric: 'total_plays' })
    expect(series.points.map((p) => p.value)).toEqual([0, 1, 0])
  })

  it('leaves out visits outside the range or with no recorded start', () => {
    const odd = [
      session({ sessionId: 'old', memberId: 'ann', startedAt: '2026-09-01T12:00:00Z' }),
      session({ sessionId: 'future', memberId: 'ann', startedAt: '2026-11-01T12:00:00Z' }),
      session({ sessionId: 'none', memberId: 'ann', startedAt: null }),
    ]
    const series = computeTimeSeries(odd, { ...base, metric: 'total_plays' })
    expect(series.total).toBe(0)
    expect(series.points.every((p) => p.value === 0)).toBe(true)
  })

  it('groups by week (Sunday first) and month, with partial buckets at the ends', () => {
    const wide = { ...base, range: { from: '2026-09-28', to: '2026-10-20' } }
    const weekly = computeTimeSeries(sessions, { ...wide, granularity: 'week', metric: 'total_plays' })
    expect(weekly.points.map((p) => p.start)).toEqual(['2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18'])
    expect(weekly.points.map((p) => p.value)).toEqual([0, 3, 0, 0])

    const monthly = computeTimeSeries(sessions, { ...wide, granularity: 'month', metric: 'total_plays' })
    expect(monthly.points.map((p) => [p.label, p.value])).toEqual([['Sep 2026', 0], ['Oct 2026', 3]])
  })

  it('reports the granularity it used when a daily range is too long', () => {
    const series = computeTimeSeries([], { ...base, range: { from: '2024-01-01', to: '2026-10-20' }, metric: 'total_plays' })
    expect(series.granularity).toBe('week')
  })

  it('has zeros, not NaN, for a bucket with nothing in it', () => {
    for (const metric of ['play_rate', 'engagement_rate', 'hours_watched', 'unique_viewers'] as const) {
      const series = computeTimeSeries([], { ...base, metric })
      expect(series.total).toBe(0)
      expect(series.points.every((p) => p.value === 0)).toBe(true)
    }
  })

  it('carries the parts of each point for a tooltip', () => {
    const series = computeTimeSeries(sessions, { ...base, metric: 'play_rate' })
    expect(series.points[1]).toMatchObject({ plays: 2, views: 3, uniquePlays: 1, uniqueViewers: 2 })
    expect(series.points[1].hoursWatched).toBeCloseTo(1200 / 3600)
  })
})

describe('parseTimeSeriesQuery', () => {
  it('reads the controls, and defaults to total plays by day over the last 30 days', () => {
    expect(parseTimeSeriesQuery({})).toEqual({ metric: 'total_plays', granularity: 'day', preset: '30d', from: null, to: null })
    expect(parseTimeSeriesQuery({ metric: 'hours_watched', by: 'week', range: 'custom', from: '2026-08-01', to: '2026-08-31' })).toEqual({
      metric: 'hours_watched',
      granularity: 'week',
      preset: 'custom',
      from: '2026-08-01',
      to: '2026-08-31',
    })
  })

  it('ignores anything it does not recognise', () => {
    expect(parseTimeSeriesQuery({ metric: 'revenue', by: 'year', range: 'forever', from: '2026-02-30', to: 'soon' })).toEqual({
      metric: 'total_plays',
      granularity: 'day',
      preset: '30d',
      from: null,
      to: null,
    })
  })
})

describe('formatMetricValue', () => {
  it('formats a count, a percent and hours', () => {
    expect(formatMetricValue(42, 'count')).toBe('42')
    expect(formatMetricValue(0.634, 'percent')).toBe('63%')
    expect(formatMetricValue(1.46, 'hours')).toBe('1.5 h')
    expect(formatMetricValue(0, 'hours')).toBe('0.0 h')
    expect(formatMetricValue(12.4, 'hours')).toBe('12 h')
  })
})
