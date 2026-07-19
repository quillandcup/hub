import { describe, it, expect } from 'vitest'
import {
  computeDayHourHeatmap,
  computeHeroStats,
  computeChannelEngagement,
  computeArchivalCandidates,
  computeTopEmoji,
  type SlackMessageRow,
  type SlackReactionRow,
  type SlackChannelRow,
  type ChannelActivityRow,
} from '@/lib/slack-engagement-stats'

// Known timestamps for ET timezone assertions (winter, EST, UTC-5)
const MON_7AM_ET = '2026-01-05T12:00:00Z' // Monday 7am ET
const MON_10AM_ET = '2026-01-05T15:00:00Z' // Monday 10am ET
const TUE_7AM_ET = '2026-01-06T12:00:00Z' // Tuesday 7am ET
const SAT_7AM_ET = '2026-01-03T12:00:00Z' // Saturday 7am ET

function makeMessage(overrides: Partial<SlackMessageRow> = {}): SlackMessageRow {
  return {
    channel_id: 'C1',
    channel_name: 'general',
    occurred_at: MON_7AM_ET,
    deleted_at: null,
    user_id: 'U1',
    thread_ts: null,
    ...overrides,
  }
}

function makeReaction(overrides: Partial<SlackReactionRow> = {}): SlackReactionRow {
  return {
    channel_id: 'C1',
    channel_name: 'general',
    occurred_at: MON_7AM_ET,
    removed_at: null,
    user_id: 'U1',
    reaction: 'thumbsup',
    ...overrides,
  }
}

function makeChannel(overrides: Partial<SlackChannelRow> = {}): SlackChannelRow {
  return {
    channel_id: 'C1',
    name: 'general',
    is_archived: false,
    is_private: false,
    member_count: 10,
    created: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// computeDayHourHeatmap
// ---------------------------------------------------------------------------

describe('computeDayHourHeatmap', () => {
  it('returns 168 cells (7 days x 24 hours) for empty input', () => {
    const result = computeDayHourHeatmap([], [])
    expect(result).toHaveLength(7 * 24)
    expect(result.every((c) => c.count === 0)).toBe(true)
  })

  it('uses 3-letter day abbreviations in Sun-Sat order', () => {
    const result = computeDayHourHeatmap([], [])
    const days = Array.from(new Set(result.map((c) => c.day)))
    expect(days).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
  })

  it('places a message in the correct day/hour cell', () => {
    const result = computeDayHourHeatmap([makeMessage({ occurred_at: MON_7AM_ET })], [])
    const cell = result.find((c) => c.day === 'Mon' && c.hour === 7)!
    expect(cell.count).toBe(1)
  })

  it('places a reaction in the correct day/hour cell', () => {
    const result = computeDayHourHeatmap([], [makeReaction({ occurred_at: TUE_7AM_ET })])
    const cell = result.find((c) => c.day === 'Tue' && c.hour === 7)!
    expect(cell.count).toBe(1)
  })

  it('combines messages and reactions in the same cell', () => {
    const result = computeDayHourHeatmap(
      [makeMessage({ occurred_at: MON_7AM_ET })],
      [makeReaction({ occurred_at: MON_7AM_ET })]
    )
    const cell = result.find((c) => c.day === 'Mon' && c.hour === 7)!
    expect(cell.count).toBe(2)
  })

  it('does not spill into neighboring cells', () => {
    const result = computeDayHourHeatmap([makeMessage({ occurred_at: MON_7AM_ET })], [])
    const monEight = result.find((c) => c.day === 'Mon' && c.hour === 8)!
    const tueSeven = result.find((c) => c.day === 'Tue' && c.hour === 7)!
    expect(monEight.count).toBe(0)
    expect(tueSeven.count).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// computeHeroStats
// ---------------------------------------------------------------------------

describe('computeHeroStats', () => {
  it('returns zeros for empty input', () => {
    const result = computeHeroStats([], [])
    expect(result).toEqual({
      totalMessages: 0,
      totalReactions: 0,
      activeChannels: 0,
      activeUsers: 0,
      busiestDay: 'Sunday',
      busiestHour: 0,
      threadReplyPct: 0,
    })
  })

  it('counts total messages and reactions', () => {
    const result = computeHeroStats(
      [makeMessage(), makeMessage()],
      [makeReaction(), makeReaction(), makeReaction()]
    )
    expect(result.totalMessages).toBe(2)
    expect(result.totalReactions).toBe(3)
  })

  it('counts distinct channels across messages and reactions', () => {
    const result = computeHeroStats(
      [makeMessage({ channel_id: 'C1' }), makeMessage({ channel_id: 'C2' })],
      [makeReaction({ channel_id: 'C2' }), makeReaction({ channel_id: 'C3' })]
    )
    expect(result.activeChannels).toBe(3)
  })

  it('counts distinct users across messages and reactions', () => {
    const result = computeHeroStats(
      [makeMessage({ user_id: 'U1' }), makeMessage({ user_id: 'U1' })],
      [makeReaction({ user_id: 'U2' })]
    )
    expect(result.activeUsers).toBe(2)
  })

  it('identifies the busiest day', () => {
    const result = computeHeroStats(
      [
        makeMessage({ occurred_at: MON_7AM_ET }),
        makeMessage({ occurred_at: MON_10AM_ET }),
        makeMessage({ occurred_at: SAT_7AM_ET }),
      ],
      []
    )
    expect(result.busiestDay).toBe('Monday')
  })

  it('identifies the busiest hour', () => {
    const result = computeHeroStats(
      [
        makeMessage({ occurred_at: MON_7AM_ET }),
        makeMessage({ occurred_at: TUE_7AM_ET }),
        makeMessage({ occurred_at: MON_10AM_ET }),
      ],
      []
    )
    expect(result.busiestHour).toBe(7)
  })

  it('computes threadReplyPct from messages with a thread_ts', () => {
    const result = computeHeroStats(
      [
        makeMessage({ thread_ts: 'ts1' }),
        makeMessage({ thread_ts: null }),
        makeMessage({ thread_ts: null }),
        makeMessage({ thread_ts: null }),
      ],
      []
    )
    expect(result.threadReplyPct).toBe(25)
  })

  it('does not divide by zero when there are no messages', () => {
    const result = computeHeroStats([], [makeReaction()])
    expect(result.threadReplyPct).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// computeChannelEngagement
// ---------------------------------------------------------------------------

describe('computeChannelEngagement', () => {
  const since = '2026-01-01T00:00:00Z'
  const until = '2026-01-21T00:00:00Z' // 20 days -> 1 sparkline bucket per day

  it('returns empty array for no messages or reactions', () => {
    expect(computeChannelEngagement([], [], [], since, until)).toEqual([])
  })

  it('counts messages, reactions, thread replies, and unique users per channel', () => {
    const messages = [
      makeMessage({ channel_id: 'C1', user_id: 'U1', thread_ts: 'ts1' }),
      makeMessage({ channel_id: 'C1', user_id: 'U2', thread_ts: null }),
    ]
    const reactions = [makeReaction({ channel_id: 'C1', user_id: 'U1' })]
    const result = computeChannelEngagement(messages, reactions, [], since, until)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      channelId: 'C1',
      messages: 2,
      reactions: 1,
      threadReplies: 1,
      uniqueUsers: 2,
    })
  })

  it('resolves channel name, member count, and privacy from the channels list', () => {
    const channels = [
      makeChannel({ channel_id: 'C1', name: 'writing-wins', member_count: 42, is_private: true }),
    ]
    const result = computeChannelEngagement(
      [makeMessage({ channel_id: 'C1', channel_name: 'stale-name' })],
      [],
      channels,
      since,
      until
    )
    expect(result[0].name).toBe('writing-wins')
    expect(result[0].memberCount).toBe(42)
    expect(result[0].isPrivate).toBe(true)
  })

  it('falls back to the message channel_name and defaults when channel is unknown', () => {
    const result = computeChannelEngagement(
      [makeMessage({ channel_id: 'C9', channel_name: 'mystery' })],
      [],
      [],
      since,
      until
    )
    expect(result[0].name).toBe('mystery')
    expect(result[0].memberCount).toBeNull()
    expect(result[0].isPrivate).toBe(false)
  })

  it('identifies the peak day and hour per channel', () => {
    const messages = [
      makeMessage({ channel_id: 'C1', occurred_at: MON_7AM_ET }),
      makeMessage({ channel_id: 'C1', occurred_at: MON_7AM_ET }),
      makeMessage({ channel_id: 'C1', occurred_at: SAT_7AM_ET }),
    ]
    const result = computeChannelEngagement(messages, [], [], since, until)
    expect(result[0].peakDay).toBe('Mon')
    expect(result[0].peakHour).toBe(7)
  })

  it('tracks the most recent occurred_at as lastActivity across messages and reactions', () => {
    const messages = [makeMessage({ channel_id: 'C1', occurred_at: '2026-01-05T12:00:00Z' })]
    const reactions = [makeReaction({ channel_id: 'C1', occurred_at: '2026-01-10T12:00:00Z' })]
    const result = computeChannelEngagement(messages, reactions, [], since, until)
    expect(result[0].lastActivity).toBe('2026-01-10T12:00:00Z')
  })

  it('sorts channels by total engagement (messages + reactions) descending', () => {
    const messages = [
      makeMessage({ channel_id: 'C1' }),
      makeMessage({ channel_id: 'C2' }),
      makeMessage({ channel_id: 'C2' }),
      makeMessage({ channel_id: 'C2' }),
    ]
    const result = computeChannelEngagement(messages, [], [], since, until)
    expect(result[0].channelId).toBe('C2')
    expect(result[1].channelId).toBe('C1')
  })

  it('limits the number of returned channels', () => {
    const messages = Array.from({ length: 20 }, (_, i) => makeMessage({ channel_id: `C${i}` }))
    const result = computeChannelEngagement(messages, [], [], since, until, 5)
    expect(result).toHaveLength(5)
  })

  it('buckets sparkline entries by time within the since/until range', () => {
    // 20-day range, 20 buckets -> ~1 day per bucket
    const messages = [
      makeMessage({ channel_id: 'C1', occurred_at: '2026-01-01T12:00:00Z' }), // ~bucket 0
      makeMessage({ channel_id: 'C1', occurred_at: '2026-01-11T12:00:00Z' }), // ~bucket 10
      makeMessage({ channel_id: 'C1', occurred_at: '2026-01-20T23:00:00Z' }), // last bucket
    ]
    const result = computeChannelEngagement(messages, [], [], since, until)
    const sparkline = result[0].sparkline
    expect(sparkline).toHaveLength(20)
    expect(sparkline.reduce((a, b) => a + b, 0)).toBe(3)
    expect(sparkline[0]).toBe(1)
    expect(sparkline[10]).toBe(1)
    expect(sparkline[19]).toBe(1)
  })

  it('clamps sparkline bucket index for timestamps outside the range', () => {
    const messages = [
      makeMessage({ channel_id: 'C1', occurred_at: '2025-01-01T00:00:00Z' }), // before since
      makeMessage({ channel_id: 'C1', occurred_at: '2027-01-01T00:00:00Z' }), // after until
    ]
    const result = computeChannelEngagement(messages, [], [], since, until)
    const sparkline = result[0].sparkline
    expect(sparkline[0]).toBe(1)
    expect(sparkline[19]).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// computeArchivalCandidates
// ---------------------------------------------------------------------------

describe('computeArchivalCandidates', () => {
  const now = new Date('2026-04-01T00:00:00Z')
  const DAY = 24 * 60 * 60 * 1000

  function daysAgo(days: number): string {
    return new Date(now.getTime() - days * DAY).toISOString()
  }

  it('excludes archived channels regardless of activity', () => {
    const channels = [makeChannel({ channel_id: 'C1', is_archived: true, created: daysAgo(400) })]
    const result = computeArchivalCandidates([], channels, now)
    expect(result).toEqual([])
  })

  it('excludes channels with recent activity (below the threshold)', () => {
    const channels = [makeChannel({ channel_id: 'C1', created: daysAgo(400) })]
    const activity: ChannelActivityRow[] = [{ channel_id: 'C1', occurred_at: daysAgo(10) }]
    const result = computeArchivalCandidates(activity, channels, now, 60)
    expect(result).toEqual([])
  })

  it('includes channels whose last activity exceeds the threshold', () => {
    const channels = [makeChannel({ channel_id: 'C1', created: daysAgo(400) })]
    const activity: ChannelActivityRow[] = [
      { channel_id: 'C1', occurred_at: daysAgo(90) },
      { channel_id: 'C1', occurred_at: daysAgo(95) },
    ]
    const result = computeArchivalCandidates(activity, channels, now, 60)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      channelId: 'C1',
      daysSinceActivity: 90,
      totalMessagesAllTime: 2,
    })
  })

  it('includes channels with zero activity ever when created outside the grace period', () => {
    const channels = [makeChannel({ channel_id: 'C1', created: daysAgo(400) })]
    const result = computeArchivalCandidates([], channels, now, 60, 30)
    expect(result).toHaveLength(1)
    expect(result[0].daysSinceActivity).toBeNull()
    expect(result[0].lastActivity).toBeNull()
    expect(result[0].totalMessagesAllTime).toBe(0)
  })

  it('excludes channels with zero activity created within the grace period', () => {
    const channels = [makeChannel({ channel_id: 'C1', created: daysAgo(5) })]
    const result = computeArchivalCandidates([], channels, now, 60, 30)
    expect(result).toEqual([])
  })

  it('treats a channel with no created date and no activity as stale', () => {
    const channels = [makeChannel({ channel_id: 'C1', created: null })]
    const result = computeArchivalCandidates([], channels, now)
    expect(result).toHaveLength(1)
  })

  it('sorts never-active channels first, then by days dormant descending', () => {
    const channels = [
      makeChannel({ channel_id: 'C1', created: daysAgo(400) }), // never active
      makeChannel({ channel_id: 'C2', created: daysAgo(400) }), // 70 days dormant
      makeChannel({ channel_id: 'C3', created: daysAgo(400) }), // 90 days dormant
    ]
    const activity: ChannelActivityRow[] = [
      { channel_id: 'C2', occurred_at: daysAgo(70) },
      { channel_id: 'C3', occurred_at: daysAgo(90) },
    ]
    const result = computeArchivalCandidates(activity, channels, now, 60)
    expect(result.map((c) => c.channelId)).toEqual(['C1', 'C3', 'C2'])
  })
})

// ---------------------------------------------------------------------------
// computeTopEmoji
// ---------------------------------------------------------------------------

describe('computeTopEmoji', () => {
  it('returns empty array for no reactions', () => {
    expect(computeTopEmoji([])).toEqual([])
  })

  it('counts reactions by emoji', () => {
    const reactions = [
      makeReaction({ reaction: 'heart' }),
      makeReaction({ reaction: 'heart' }),
      makeReaction({ reaction: 'tada' }),
    ]
    const result = computeTopEmoji(reactions)
    expect(result).toEqual([
      { emoji: 'heart', count: 2 },
      { emoji: 'tada', count: 1 },
    ])
  })

  it('sorts by count descending', () => {
    const reactions = [
      makeReaction({ reaction: 'tada' }),
      makeReaction({ reaction: 'heart' }),
      makeReaction({ reaction: 'heart' }),
      makeReaction({ reaction: 'heart' }),
    ]
    const result = computeTopEmoji(reactions)
    expect(result[0].emoji).toBe('heart')
  })

  it('limits results to the given limit', () => {
    const reactions = Array.from({ length: 15 }, (_, i) => makeReaction({ reaction: `emoji${i}` }))
    expect(computeTopEmoji(reactions, 5)).toHaveLength(5)
  })
})
