import { describe, it, expect } from 'vitest'
import { findStalePrivateChannels, type SlackChannelRow } from '@/lib/private-channel-access'

function channel(overrides: Partial<SlackChannelRow>): SlackChannelRow {
  return {
    channel_id: 'C1',
    name: 'general',
    is_private: false,
    imported_at: '2026-08-27T02:45:00.000Z',
    ...overrides,
  }
}

describe('findStalePrivateChannels', () => {
  it('returns nothing when there are no channels', () => {
    expect(findStalePrivateChannels([])).toEqual([])
  })

  it('returns nothing when every channel was refreshed in the latest import batch', () => {
    const channels = [
      channel({ channel_id: 'C1', is_private: false, imported_at: '2026-08-27T02:45:00.000Z' }),
      channel({ channel_id: 'C2', is_private: true, imported_at: '2026-08-27T02:45:00.000Z' }),
    ]

    expect(findStalePrivateChannels(channels)).toEqual([])
  })

  it('ignores stale public channels — only private channels can silently lose access', () => {
    const channels = [
      channel({ channel_id: 'C1', name: 'general', is_private: false, imported_at: '2026-08-20T02:45:00.000Z' }),
      channel({ channel_id: 'C2', name: 'huddle', is_private: true, imported_at: '2026-08-27T02:45:00.000Z' }),
    ]

    expect(findStalePrivateChannels(channels)).toEqual([])
  })

  it('flags a private channel not refreshed in the latest import batch', () => {
    const channels = [
      channel({ channel_id: 'C1', name: 'general', is_private: false, imported_at: '2026-08-27T02:45:00.000Z' }),
      channel({
        channel_id: 'C2',
        name: 'hedgie-huddle',
        is_private: true,
        imported_at: '2026-08-25T02:45:00.000Z',
      }),
    ]

    expect(findStalePrivateChannels(channels)).toEqual([
      { channelId: 'C2', channelName: 'hedgie-huddle', lastSeenAt: '2026-08-25T02:45:00.000Z' },
    ])
  })

  it('sorts multiple stale channels oldest-lost-first', () => {
    const channels = [
      channel({ channel_id: 'C1', is_private: false, imported_at: '2026-08-27T02:45:00.000Z' }),
      channel({ channel_id: 'C2', name: 'b', is_private: true, imported_at: '2026-08-24T00:00:00.000Z' }),
      channel({ channel_id: 'C3', name: 'a', is_private: true, imported_at: '2026-08-20T00:00:00.000Z' }),
    ]

    expect(findStalePrivateChannels(channels).map((c) => c.channelId)).toEqual(['C3', 'C2'])
  })
})
