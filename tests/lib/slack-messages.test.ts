import { describe, it, expect, vi } from 'vitest'
import {
  addSlackMessage,
  slackEventChannelType,
  isKeptSlackMessage,
  isSlackSystemMessage,
  slackMessageText,
  slackMessageUserId,
  threadKey,
  threadsNeedingReplies,
  type StoredThreadReplies,
} from '@/lib/slack-messages'

describe('isKeptSlackMessage', () => {
  it.each([
    [{}, true],
    [{ subtype: 'file_share' }, true],
    [{ subtype: 'thread_broadcast' }, true],
    [{ subtype: 'channel_name' }, true],
    [{ subtype: 'channel_archive' }, true],
    [{ subtype: 'group_topic' }, true],
    [{ subtype: 'channel_join' }, true],
    [{ subtype: 'channel_leave' }, true],
    [{ subtype: 'group_join' }, true],
    [{ subtype: 'group_leave' }, true],
    [{ subtype: 'message_changed' }, false],
    [{ subtype: 'message_deleted' }, false],
    [{ subtype: 'bot_message' }, false],
  ])('%j -> %s', (msg, kept) => {
    expect(isKeptSlackMessage(msg)).toBe(kept)
  })
})

describe('isSlackSystemMessage', () => {
  it('is true for channel notices (changes, joins, leaves) only', () => {
    expect(isSlackSystemMessage({ subtype: 'channel_purpose' })).toBe(true)
    expect(isSlackSystemMessage({ subtype: 'channel_join' })).toBe(true)
    expect(isSlackSystemMessage({ subtype: 'group_leave' })).toBe(true)
    expect(isSlackSystemMessage({ subtype: 'file_share' })).toBe(false)
    expect(isSlackSystemMessage({})).toBe(false)
  })
})

describe('slackMessageUserId', () => {
  it('prefers the user, then the bot, then "unknown"', () => {
    expect(slackMessageUserId({ user: 'U1', bot_id: 'B1' })).toBe('U1')
    expect(slackMessageUserId({ bot_id: 'B1' })).toBe('B1')
    expect(slackMessageUserId({})).toBe('unknown')
  })
})

describe('threadsNeedingReplies', () => {
  const now = 1_790_900_000
  const day = 24 * 60 * 60
  const recentSince = now - 3 * day
  const thread = (ts: number, replyCount: number, latestReply?: number, channel = 'C1') => ({
    channel_id: channel,
    message_ts: `${ts}.000100`,
    reply_count: replyCount,
    raw_payload: latestReply ? { latest_reply: `${latestReply}.000200` } : {},
  })
  const stored = (entries: [ReturnType<typeof thread>, StoredThreadReplies][]) =>
    new Map(entries.map(([t, s]) => [threadKey(t.channel_id, t.message_ts), s]))

  it('fetches a thread with no stored replies', () => {
    const t = thread(now - 30 * day, 2, now - 29 * day)
    expect(threadsNeedingReplies([t], new Map(), recentSince)).toEqual([t])
  })

  it('fetches a thread with fewer stored replies than Slack reports', () => {
    const t = thread(now - 30 * day, 3, now - 29 * day)
    expect(threadsNeedingReplies([t], stored([[t, { count: 2, latestTs: `${now - 29 * day}.000200` }]]), recentSince)).toEqual([t])
  })

  it('fetches a thread whose latest reply is newer than the newest stored one', () => {
    // Same count: one reply deleted, another added.
    const t = thread(now - 30 * day, 2, now - 10 * day)
    expect(threadsNeedingReplies([t], stored([[t, { count: 2, latestTs: `${now - 20 * day}.000200` }]]), recentSince)).toEqual([t])
  })

  it('skips an old thread whose replies are all stored', () => {
    const t = thread(now - 30 * day, 2, now - 29 * day)
    expect(threadsNeedingReplies([t], stored([[t, { count: 2, latestTs: `${now - 29 * day}.000200` }]]), recentSince)).toEqual([])
  })

  it('still fetches a fully stored thread active within the recent window (reactions)', () => {
    const t = thread(now - 30 * day, 2, now - day)
    expect(threadsNeedingReplies([t], stored([[t, { count: 2, latestTs: `${now - day}.000200` }]]), recentSince)).toEqual([t])
  })

  it('fetches a thread with more live stored replies than Slack reports, so the deleted reply can be marked', () => {
    const t = thread(now - 30 * day, 1, now - 29 * day)
    expect(threadsNeedingReplies([t], stored([[t, { count: 2, latestTs: `${now - 29 * day}.000200` }]]), recentSince)).toEqual([t])
  })

  it('ignores messages without replies', () => {
    expect(threadsNeedingReplies([thread(now, 0)], new Map(), recentSince)).toEqual([])
  })

  it('falls back to the parent ts for recency when Slack omits latest_reply', () => {
    const recent = thread(now - day, 1)
    const old = thread(now - 30 * day, 1)
    const have: StoredThreadReplies = { count: 1, latestTs: null }
    expect(threadsNeedingReplies([recent, old], stored([[recent, have], [old, have]]), recentSince)).toEqual([recent])
  })

  it('keys stored replies by channel as well as ts', () => {
    const a = thread(now - 30 * day, 1, now - 29 * day, 'C1')
    const b = thread(now - 30 * day, 1, now - 29 * day, 'C2')
    const have = stored([[a, { count: 1, latestTs: `${now - 29 * day}.000200` }]])
    expect(threadsNeedingReplies([a, b], have, recentSince)).toEqual([b])
  })

  it('fetches threads that are behind oldest first, since they leave Slack’s 90-day history first', () => {
    const older = thread(now - 60 * day, 1, now - 50 * day)
    const newest = thread(now - 40 * day, 1, now - 2 * day)
    const middle = thread(now - 50 * day, 1, now - 20 * day)
    expect(threadsNeedingReplies([newest, older, middle], new Map(), recentSince)).toEqual([older, middle, newest])
  })

  it('puts recent-reply re-checks after every thread that is behind, newest activity first', () => {
    const upToDate = { count: 1, latestTs: null as string | null }
    const recentA = thread(now - 30 * day, 1, now - 2 * day)
    const recentB = thread(now - 20 * day, 1, now - day)
    const behindOld = thread(now - 80 * day, 1, now - 70 * day)
    const behindNew = thread(now - 10 * day, 1, now - 5 * day)
    const have = stored([
      [recentA, { ...upToDate, latestTs: recentA.raw_payload.latest_reply! }],
      [recentB, { ...upToDate, latestTs: recentB.raw_payload.latest_reply! }],
    ])
    expect(threadsNeedingReplies([recentA, behindNew, recentB, behindOld], have, recentSince)).toEqual([
      behindOld,
      behindNew,
      recentB,
      recentA,
    ])
  })
})

describe('slackMessageText', () => {
  it('says who added someone to a channel, which Slack only gives in `inviter`', () => {
    expect(slackMessageText({ subtype: 'channel_join', user: 'U1', inviter: 'U9', text: '<@U1> has joined the channel' })).toBe('<@U1> was added to the channel by <@U9>')
    expect(slackMessageText({ subtype: 'group_join', user: 'U1', inviter: 'U9', text: 'x' })).toBe('<@U1> was added to the channel by <@U9>')
  })

  it('keeps Slack\'s text for someone who joined on their own, a leave, and any other message', () => {
    expect(slackMessageText({ subtype: 'channel_join', user: 'U1', text: '<@U1> has joined the channel' })).toBe('<@U1> has joined the channel')
    expect(slackMessageText({ subtype: 'channel_join', user: 'U1', inviter: 'U1', text: '<@U1> has joined the channel' })).toBe('<@U1> has joined the channel')
    expect(slackMessageText({ subtype: 'channel_leave', user: 'U1', text: '<@U1> has left the channel' })).toBe('<@U1> has left the channel')
    expect(slackMessageText({ text: 'hello' })).toBe('hello')
    expect(slackMessageText({})).toBe('')
  })
})

describe('addSlackMessage tombstones', () => {
  it('stores a deleted parent with its thread metadata, without treating the placeholder as live content', () => {
    const messages: any[] = [];
    const reactions: any[] = [];
    addSlackMessage({ ts: '123.000001', subtype: 'tombstone', text: 'This message was deleted.', thread_ts: '123.000001', reply_count: 2 }, 'C1', 'general', 'channel', messages, reactions);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ message_type: 'tombstone', thread_ts: '123.000001', reply_count: 2, deleted_at: expect.any(String) });
    expect(reactions).toEqual([]);
  });
});

describe('slackEventChannelType', () => {
  const never = async () => false
  it('names a live event\'s conversation the way the import does', async () => {
    expect(await slackEventChannelType({ channel_type: 'im' }, never)).toBe('im')
    expect(await slackEventChannelType({ channel_type: 'mpim' }, never)).toBe('mpim')
    expect(await slackEventChannelType({ channel_type: 'channel' }, never)).toBe('public_channel')
  })

  it('tells a private channel from an older group DM by the stored conversation', async () => {
    expect(await slackEventChannelType({ channel_type: 'group' }, never)).toBe('private_channel')
    expect(await slackEventChannelType({ channel_type: 'group' }, async () => true)).toBe('mpim')
  })

  it('knows a 1:1 DM from its id when the event names no type (the bot\'s own posts)', async () => {
    expect(await slackEventChannelType({ channel: 'D01ABC2DEF3' }, never)).toBe('im')
    expect(await slackEventChannelType({ channel: 'C01ABC2DEF3' }, never)).toBeNull()
  })

  it('says nothing when the event names no type, and asks nothing of the database for the others', async () => {
    const lookup = vi.fn(async () => true)
    expect(await slackEventChannelType({}, lookup)).toBeNull()
    expect(await slackEventChannelType({ channel_type: 'something-new' }, lookup)).toBeNull()
    expect(await slackEventChannelType({ channel_type: 'im' }, lookup)).toBe('im')
    expect(lookup).not.toHaveBeenCalled()
  })
})
