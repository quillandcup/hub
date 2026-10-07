import { describe, it, expect } from 'vitest'
import {
  deletionInferenceWindow,
  isBeyondSlackHistory,
  isSuspiciousDeletionCount,
  messagesMissingFromSlack,
  slackThreadKey,
  type SeenInSlack,
} from '@/lib/slack-deletions'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-10-07T12:00:00.000Z')
const nowSec = NOW / 1000
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const tsAgo = (ms: number, n = 1) => `${Math.floor((NOW - ms) / 1000)}.${String(n).padStart(6, '0')}`

describe('deletionInferenceWindow', () => {
  it('for a 90-day import, starts 80 days back (well inside Slack’s history) and ends 15 minutes ago', () => {
    expect(deletionInferenceWindow(nowSec - 90 * 86400, nowSec, NOW)).toEqual({
      from: ago(80 * DAY),
      to: ago(15 * 60 * 1000),
    })
  })

  it('for a shorter import, stays a minute inside the range that was fetched', () => {
    expect(deletionInferenceWindow(nowSec - 7 * 86400, nowSec, NOW)).toEqual({
      from: ago(7 * DAY - 60_000),
      to: ago(15 * 60 * 1000),
    })
  })

  it('is null when the fetched range leaves no room', () => {
    expect(deletionInferenceWindow(nowSec - 600, nowSec, NOW)).toBeNull()
  })
})

describe('messagesMissingFromSlack', () => {
  const window = deletionInferenceWindow(nowSec - 90 * 86400, nowSec, NOW)
  const top = (channel: string, ageMs: number, n = 1) => ({
    channel_id: channel,
    message_ts: tsAgo(ageMs, n),
    thread_ts: null,
    occurred_at: ago(ageMs),
  })
  const reply = (channel: string, parentTs: string, ageMs: number, n = 2) => ({
    channel_id: channel,
    message_ts: tsAgo(ageMs, n),
    thread_ts: parentTs,
    occurred_at: ago(ageMs),
  })
  const seen = (topLevel: Record<string, string[]>, replies: Record<string, string[]> = {}): SeenInSlack => ({
    topLevelByChannel: new Map(Object.entries(topLevel).map(([c, ts]) => [c, new Set(ts)])),
    repliesByThread: new Map(Object.entries(replies).map(([k, ts]) => [k, new Set(ts)])),
  })

  it('flags a top-level message Slack did not return for a fully fetched channel', () => {
    const kept = top('C1', 5 * DAY, 1)
    const gone = top('C1', 6 * DAY, 2)
    expect(messagesMissingFromSlack([kept, gone], seen({ C1: [kept.message_ts] }), window)).toEqual([gone])
  })

  it('never flags a message at or beyond the edge of Slack’s history, even though Slack no longer returns it', () => {
    const aged = [top('C1', 81 * DAY), top('C1', 89 * DAY), top('C1', 120 * DAY), top('C1', 400 * DAY)]
    expect(messagesMissingFromSlack(aged, seen({ C1: [] }), window)).toEqual([])
  })

  it('never flags a message too new for the fetch to have seen', () => {
    expect(messagesMissingFromSlack([top('C1', 5 * 60 * 1000)], seen({ C1: [] }), window)).toEqual([])
  })

  it('gives no verdict for a channel that was not fetched', () => {
    expect(messagesMissingFromSlack([top('C2', 5 * DAY)], seen({ C1: [] }), window)).toEqual([])
  })

  it('judges a reply only against a thread whose replies were fetched', () => {
    const parent = top('C1', 10 * DAY, 1)
    const live = reply('C1', parent.message_ts, 9 * DAY, 2)
    const gone = reply('C1', parent.message_ts, 8 * DAY, 3)
    const otherParentTs = tsAgo(20 * DAY, 9)
    const unknown = reply('C1', otherParentTs, 19 * DAY, 4)
    const fetched = seen({ C1: [parent.message_ts, otherParentTs] }, { [slackThreadKey('C1', parent.message_ts)]: [live.message_ts] })

    // `unknown` is missing from the channel history like every reply, but its thread wasn't fetched.
    expect(messagesMissingFromSlack([parent, live, gone, unknown], fetched, window)).toEqual([gone])
  })

  it('flags stored replies to a message Slack says has no replies', () => {
    const parent = top('C1', 10 * DAY, 1)
    const gone = reply('C1', parent.message_ts, 9 * DAY, 2)
    const fetched = seen({ C1: [parent.message_ts] }, { [slackThreadKey('C1', parent.message_ts)]: [] })
    expect(messagesMissingFromSlack([parent, gone], fetched, window)).toEqual([gone])
  })

  it('treats a message whose thread_ts is its own ts as top-level', () => {
    const root = { ...top('C1', 5 * DAY), thread_ts: tsAgo(5 * DAY) }
    expect(messagesMissingFromSlack([root], seen({ C1: [] }), window)).toEqual([root])
  })

  it('flags nothing without a window', () => {
    expect(messagesMissingFromSlack([top('C1', 5 * DAY)], seen({ C1: [] }), null)).toEqual([])
  })
})

describe('isSuspiciousDeletionCount', () => {
  it('accepts a handful of deletions whatever the share', () => {
    expect(isSuspiciousDeletionCount(10, 10)).toBe(false)
    expect(isSuspiciousDeletionCount(3, 4)).toBe(false)
  })

  it('accepts more when they are a small share of the channel', () => {
    expect(isSuspiciousDeletionCount(20, 400)).toBe(false)
  })

  it('rejects a large share of a channel going missing at once', () => {
    expect(isSuspiciousDeletionCount(11, 40)).toBe(true)
    expect(isSuspiciousDeletionCount(300, 400)).toBe(true)
  })
})

describe('isBeyondSlackHistory', () => {
  it('is false for a message Slack still shows and true past 90 days', () => {
    expect(isBeyondSlackHistory(tsAgo(1 * DAY), NOW)).toBe(false)
    expect(isBeyondSlackHistory(tsAgo(89 * DAY), NOW)).toBe(false)
    expect(isBeyondSlackHistory(tsAgo(91 * DAY), NOW)).toBe(true)
    expect(isBeyondSlackHistory(tsAgo(400 * DAY), NOW)).toBe(true)
  })

  it('is false for a ts it cannot read, so an odd event is handled normally', () => {
    expect(isBeyondSlackHistory('not-a-ts', NOW)).toBe(false)
  })
})
