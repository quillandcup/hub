import { describe, expect, it } from 'vitest'
import { computePlaySessions, computeVideoWatchStats, formatClock, MAX_BUCKETS, type ViewMarker, type WatchSegment } from '@/lib/courses/watch-stats'

// By default each member has one player session of their own.
const seg = (memberId: string, start: number, end: number, over: Partial<WatchSegment> = {}): WatchSegment => ({
  memberId,
  sessionId: `session-${memberId}`,
  start,
  end,
  rate: 1,
  captions: null,
  visible: true,
  ...over,
})

describe('computeVideoWatchStats', () => {
  it('is empty with no segments or no usable length', () => {
    expect(computeVideoWatchStats([], 100)).toMatchObject({ viewers: 0, plays: 0, engagementRate: 0, buckets: [], watchedSeconds: 0 })
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
    expect(first).toMatchObject({ timesWatched: 2, plays: 1, people: 1 })
    expect(last).toMatchObject({ timesWatched: 0, plays: 0, people: 0 })
  })

  it('does not double count overlapping stretches in the same member\'s coverage', () => {
    const stats = computeVideoWatchStats([seg('a', 0, 60), seg('a', 40, 100)], 100)
    expect(stats.uniqueWatchedSeconds).toBe(100)
    expect(stats.averageWatchedFraction).toBeCloseTo(1)
    expect(stats.watchedMarkViewers).toBe(1)
    // The 40 to 60 overlap was played twice.
    const middle = stats.buckets[50]
    expect(middle).toMatchObject({ timesWatched: 2, plays: 1, people: 1 })
  })

  it('shows a drop-off: fewer viewers further in', () => {
    const stats = computeVideoWatchStats([seg('a', 0, 100), seg('b', 0, 50), seg('c', 0, 10)], 100)
    expect(stats.buckets[5].people).toBe(3)
    expect(stats.buckets[30].people).toBe(2)
    expect(stats.buckets[80].people).toBe(1)
  })

  it('splits plays, people and plays-per-session across buckets in proportion to the overlap, on one scale', () => {
    // 10s video, 10 buckets of 1s: 0.5 to 2.5 covers half of bucket 0, all of 1, half of 2.
    const stats = computeVideoWatchStats([seg('a', 0.5, 2.5)], 10)
    expect(stats.buckets).toHaveLength(10)
    expect(stats.buckets.slice(0, 4).map((b) => b.timesWatched)).toEqual([0.5, 1, 0.5, 0])
    // One person covering half a slice is half a person there, not a whole one: the same numbers as plays.
    expect(stats.buckets.slice(0, 4).map((b) => b.people)).toEqual([0.5, 1, 0.5, 0])
    expect(stats.buckets.slice(0, 4).map((b) => b.plays)).toEqual([0.5, 1, 0.5, 0])
  })

  it('never shows more people than times watched, and the two coincide wherever nobody rewatched', () => {
    // Several people, short and uneven stretches (so slices at the edges are partly covered), nobody replaying anything.
    const stats = computeVideoWatchStats([seg('a', 3.3, 41.7), seg('b', 10.2, 22.9), seg('c', 60, 77.4), seg('d', 70.1, 99.9)], 100)
    for (const b of stats.buckets) {
      expect(b.people).toBeLessThanOrEqual(b.timesWatched + 1e-9)
      expect(b.people).toBeCloseTo(b.timesWatched, 3)
      expect(b.plays).toBeCloseTo(b.timesWatched, 3)
    }
  })

  it('shows rewatching as plays above people, by exactly the replayed share of the slice', () => {
    // a watches 0 to 50, then 25 to 75: 25 to 50 is played twice by one person.
    const stats = computeVideoWatchStats([seg('a', 0, 50), seg('a', 25, 75)], 100)
    const at = (second: number) => stats.buckets[Math.floor(second)]
    expect(at(10)).toMatchObject({ timesWatched: 1, plays: 1, people: 1 })
    expect(at(30)).toMatchObject({ timesWatched: 2, plays: 1, people: 1 })
    expect(at(60)).toMatchObject({ timesWatched: 1, plays: 1, people: 1 })
    for (const b of stats.buckets) expect(b.people).toBeLessThanOrEqual(b.timesWatched + 1e-9)
  })

  it('caps the buckets and spans the whole video', () => {
    const stats = computeVideoWatchStats([seg('a', 0, 3000)], 3000)
    expect(stats.buckets).toHaveLength(MAX_BUCKETS)
    expect(stats.buckets[0].start).toBe(0)
    expect(stats.buckets[MAX_BUCKETS - 1].end).toBeCloseTo(3000)
    expect(stats.buckets.every((b) => b.timesWatched > 0.99 && b.timesWatched < 1.01)).toBe(true)
  })

  it('clips stretches to the video and falls back to the furthest point when the length is unknown', () => {
    const clipped = computeVideoWatchStats([seg('a', 90, 130)], 100)
    expect(clipped.watchedSeconds).toBe(10)
    const unknown = computeVideoWatchStats([seg('a', 0, 40)], null)
    expect(unknown.durationSeconds).toBe(40)
    expect(unknown.averageWatchedFraction).toBeCloseTo(1)
  })

  it('counts a play per player session, so coming back on another day is another play', () => {
    const stats = computeVideoWatchStats(
      [seg('a', 0, 100, { sessionId: 'a-monday' }), seg('a', 0, 50, { sessionId: 'a-friday' }), seg('b', 0, 100, { sessionId: 'b-1' }), seg('b', 0, 10, { sessionId: 'b-1' })],
      100,
    )
    expect(stats.viewers).toBe(2)
    expect(stats.plays).toBe(3)
  })

  it("gives Kajabi's engagement: total watch time over plays times video length", () => {
    // Two plays of a 100s video: one watched all of it, one watched 20s.
    const stats = computeVideoWatchStats([seg('a', 0, 100), seg('b', 0, 20)], 100)
    expect(stats.plays).toBe(2)
    expect(stats.engagementRate).toBeCloseTo(120 / 200)
    // Rewatching inside a play adds to the time, so it can lift a play above one full watch.
    const rewatch = computeVideoWatchStats([seg('a', 0, 100), seg('a', 0, 50)], 100)
    expect(rewatch.plays).toBe(1)
    expect(rewatch.engagementRate).toBeCloseTo(1.5)
  })

  it("shows, per slice, how many plays watched it, which over the plays is that moment's engagement", () => {
    const stats = computeVideoWatchStats([seg('a', 0, 100), seg('b', 0, 50), seg('c', 0, 10)], 100)
    expect(stats.plays).toBe(3)
    expect(stats.buckets[5].plays).toBe(3)
    expect(stats.buckets[30].plays).toBe(2)
    expect(stats.buckets[80].plays).toBe(1)
    // A rewatch inside one play is still one play at that slice.
    const again = computeVideoWatchStats([seg('a', 0, 50), seg('a', 0, 50)], 100)
    expect(again.buckets[10]).toMatchObject({ timesWatched: 2, plays: 1, people: 1 })
  })

  it('nests the three counts, people <= plays <= times watched: a rewind in a visit, then a return on another day', () => {
    // Ann plays 0-50 and rewinds to replay 0-50 in one visit, then returns another day for 0-50 again; Bea plays 0-50 once.
    const stats = computeVideoWatchStats(
      [seg('ann', 0, 50, { sessionId: 'ann-1' }), seg('ann', 0, 50, { sessionId: 'ann-1' }), seg('ann', 0, 50, { sessionId: 'ann-2' }), seg('bea', 0, 50, { sessionId: 'bea-1' })],
      100,
    )
    // Four passes, three visits, two people.
    expect(stats.buckets[10]).toMatchObject({ timesWatched: 4, plays: 3, people: 2 })
    expect(stats.plays).toBe(3)
    expect(stats.viewers).toBe(2)
    for (const b of stats.buckets) {
      expect(b.people).toBeLessThanOrEqual(b.plays + 1e-9)
      expect(b.plays).toBeLessThanOrEqual(b.timesWatched + 1e-9)
    }
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

const view = (memberId: string, sessionId: string, startedAt = '2026-10-06T22:10:00Z', userAgent: string | null = null): ViewMarker => ({ memberId, sessionId, startedAt, userAgent })

describe('views and play rate', () => {
  it('counts a view per player session, whether or not anything was played, and the play rate over them', () => {
    // Four visits: two played (a, b), two only opened the lesson (c, d).
    const stats = computeVideoWatchStats([seg('a', 0, 50), seg('b', 0, 50)], 100, [view('a', 'session-a'), view('b', 'session-b'), view('c', 'session-c'), view('d', 'session-d')])
    expect(stats.views).toBe(4)
    expect(stats.plays).toBe(2)
    expect(stats.playRate).toBeCloseTo(0.5)
  })

  it('counts a session with stretches as viewed even without a marker, so a marker that never arrived cannot push play rate above 100%', () => {
    const stats = computeVideoWatchStats([seg('a', 0, 50), seg('b', 0, 50)], 100)
    expect(stats.views).toBe(2)
    expect(stats.playRate).toBe(1)
    // A marker for a session that also played is one view, not two.
    expect(computeVideoWatchStats([seg('a', 0, 50)], 100, [view('a', 'session-a')]).views).toBe(1)
  })

  it('still reports views when nothing was played', () => {
    const stats = computeVideoWatchStats([], 100, [view('a', 'session-a'), view('b', 'session-b')])
    expect(stats).toMatchObject({ views: 2, plays: 0, playRate: 0, viewers: 0, buckets: [] })
  })
})

describe('computePlaySessions', () => {
  it('gives one row per player session, newest first, with who, the device and how much was covered', () => {
    const sessions = computePlaySessions(
      [
        seg('a', 0, 50, { sessionId: 'a-1', startedAt: '2026-10-06T22:10:30Z' }),
        seg('a', 25, 75, { sessionId: 'a-1', startedAt: '2026-10-06T22:12:00Z' }),
        seg('b', 0, 100, { sessionId: 'b-1', startedAt: '2026-10-05T20:24:30Z' }),
      ],
      100,
      [view('a', 'a-1', '2026-10-06T22:10:00Z', 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36'), view('b', 'b-1', '2026-10-05T20:24:00Z')],
    )

    expect(sessions.map((s) => s.sessionId)).toEqual(['a-1', 'b-1'])
    expect(sessions[0]).toMatchObject({ memberId: 'a', startedAt: '2026-10-06T22:10:00Z', played: true, watchedSeconds: 100, coveredFraction: 0.75, intervals: [[0, 0.75]] })
    expect(sessions[0].userAgent).toContain('Windows')
    expect(sessions[1]).toMatchObject({ memberId: 'b', coveredFraction: 1, userAgent: null })
  })

  it('lists a visit that only opened the lesson, with no coverage', () => {
    const [only] = computePlaySessions([], 100, [view('c', 'c-1')])
    expect(only).toMatchObject({ memberId: 'c', played: false, watchedSeconds: 0, coveredFraction: 0, intervals: [] })
  })

  it('keeps separate stretches apart in the intervals, as fractions of the video, and clips to its length', () => {
    const [one] = computePlaySessions([seg('a', 10, 20, { sessionId: 's' }), seg('a', 60, 130, { sessionId: 's' })], 100)
    expect(one.intervals).toEqual([[0.1, 0.2], [0.6, 1]])
    expect(one.coveredFraction).toBeCloseTo(0.5)
  })

  it('falls back to the furthest point reached when the length is unknown', () => {
    const [one] = computePlaySessions([seg('a', 0, 40)], null)
    expect(one.coveredFraction).toBe(1)
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
