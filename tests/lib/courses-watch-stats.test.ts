import { describe, expect, it } from 'vitest'
import { computeVideoWatchStats, formatClock, MAX_BUCKETS, type WatchSegment } from '@/lib/courses/watch-stats'

const seg = (memberId: string, start: number, end: number, over: Partial<WatchSegment> = {}): WatchSegment => ({
  memberId,
  start,
  end,
  rate: 1,
  captions: null,
  visible: true,
  ...over,
})

describe('computeVideoWatchStats', () => {
  it('is empty with no segments or no usable length', () => {
    expect(computeVideoWatchStats([], 100)).toMatchObject({ viewers: 0, buckets: [], watchedSeconds: 0 })
    expect(computeVideoWatchStats([seg('a', 5, 5)], 100).viewers).toBe(0)
    expect(computeVideoWatchStats([], null).durationSeconds).toBe(0)
  })

  it('counts viewers, watched time and the average share each viewer covered', () => {
    const stats = computeVideoWatchStats([seg('a', 0, 100), seg('b', 0, 50)], 100)
    expect(stats.viewers).toBe(2)
    expect(stats.watchedSeconds).toBe(150)
    expect(stats.uniqueWatchedSeconds).toBe(150)
    expect(stats.averageWatchedFraction).toBeCloseTo(0.75)
    expect(stats.watchedMarkViewers).toBe(1)
  })

  it('counts a rewatch as another play but not as another viewer, and not as more of the video covered', () => {
    // One member watches the first half, then goes back and watches it again.
    const stats = computeVideoWatchStats([seg('a', 0, 50), seg('a', 0, 50)], 100)
    expect(stats.viewers).toBe(1)
    expect(stats.watchedSeconds).toBe(100)
    expect(stats.uniqueWatchedSeconds).toBe(50)
    expect(stats.averageWatchedFraction).toBeCloseTo(0.5)
    const first = stats.buckets[0]
    const last = stats.buckets[stats.buckets.length - 1]
    expect(first).toMatchObject({ plays: 2, viewers: 1 })
    expect(last).toMatchObject({ plays: 0, viewers: 0 })
  })

  it('does not double count overlapping stretches in the same member\'s coverage', () => {
    const stats = computeVideoWatchStats([seg('a', 0, 60), seg('a', 40, 100)], 100)
    expect(stats.uniqueWatchedSeconds).toBe(100)
    expect(stats.averageWatchedFraction).toBeCloseTo(1)
    expect(stats.watchedMarkViewers).toBe(1)
    // The 40 to 60 overlap was played twice.
    const middle = stats.buckets[50]
    expect(middle).toMatchObject({ plays: 2, viewers: 1 })
  })

  it('shows a drop-off: fewer viewers further in', () => {
    const stats = computeVideoWatchStats([seg('a', 0, 100), seg('b', 0, 50), seg('c', 0, 10)], 100)
    expect(stats.buckets[5].viewers).toBe(3)
    expect(stats.buckets[30].viewers).toBe(2)
    expect(stats.buckets[80].viewers).toBe(1)
  })

  it('splits plays across buckets in proportion to the overlap', () => {
    // 10s video, 10 buckets of 1s: 0.5 to 2.5 covers half of bucket 0, all of 1, half of 2.
    const stats = computeVideoWatchStats([seg('a', 0.5, 2.5)], 10)
    expect(stats.buckets).toHaveLength(10)
    expect(stats.buckets.slice(0, 4).map((b) => b.plays)).toEqual([0.5, 1, 0.5, 0])
    // A bucket counts as viewed once it is at least half covered.
    expect(stats.buckets.slice(0, 4).map((b) => b.viewers)).toEqual([1, 1, 1, 0])
  })

  it('caps the buckets and spans the whole video', () => {
    const stats = computeVideoWatchStats([seg('a', 0, 3000)], 3000)
    expect(stats.buckets).toHaveLength(MAX_BUCKETS)
    expect(stats.buckets[0].start).toBe(0)
    expect(stats.buckets[MAX_BUCKETS - 1].end).toBeCloseTo(3000)
    expect(stats.buckets.every((b) => b.plays > 0.99 && b.plays < 1.01)).toBe(true)
  })

  it('clips stretches to the video and falls back to the furthest point when the length is unknown', () => {
    const clipped = computeVideoWatchStats([seg('a', 90, 130)], 100)
    expect(clipped.watchedSeconds).toBe(10)
    const unknown = computeVideoWatchStats([seg('a', 0, 40)], null)
    expect(unknown.durationSeconds).toBe(40)
    expect(unknown.averageWatchedFraction).toBeCloseTo(1)
  })

  it('breaks time down by speed, captions and background playing', () => {
    const stats = computeVideoWatchStats(
      [
        seg('a', 0, 60, { rate: 1.5, captions: 'English' }),
        seg('a', 60, 80, { rate: 1.5, visible: false }),
        seg('b', 0, 20, { rate: 1 }),
      ],
      100,
    )
    expect(stats.speeds).toEqual([
      { rate: 1.5, seconds: 80 },
      { rate: 1, seconds: 20 },
    ])
    expect(stats.captionsShare).toBeCloseTo(0.6)
    expect(stats.backgroundShare).toBeCloseTo(0.2)
  })
})

describe('formatClock', () => {
  it('formats minutes and seconds, and hours from an hour up', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(65.4)).toBe('1:05')
    expect(formatClock(3725)).toBe('1:02:05')
    expect(formatClock(-3)).toBe('0:00')
  })
})
