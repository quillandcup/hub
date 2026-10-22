import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { createHmac } from 'crypto'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { POST } from '@/app/api/webhooks/slack/route'

/**
 * The webhook fills gaps in the chat from Slack: an event that refers to a message the chat doesn't
 * have (a reaction or edit on it) fetches that message, a reply whose thread root is missing fetches
 * the thread, and nothing is fetched for a message the chat has, or for a delete (there is nothing to
 * fetch). The fetching itself is in lib/chat/gap-fill (unit tests); this is the webhook's wiring.
 */
// The webhook does its work after the response; collect it so a test can wait for it.
const { afterWork } = vi.hoisted(() => ({ afterWork: [] as Promise<unknown>[] }))
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (callback: () => void | Promise<void>) => {
      afterWork.push(Promise.resolve().then(callback))
    },
  }
})

vi.mock('@/lib/processing/trigger', () => ({
  triggerReprocessing: vi.fn(() => Promise.resolve({ processed: [] })),
}))

const { fillMessageGap, fillThreadIfRootMissing } = vi.hoisted(() => ({
  fillMessageGap: vi.fn(),
  fillThreadIfRootMissing: vi.fn(),
}))
vi.mock('@/lib/chat/gap-fill', () => ({ fillMessageGap, fillThreadIfRootMissing }))

const channelId = `CGAPFILL${Date.now()}`
const nowSec = Math.floor(Date.now() / 1000)
const rootTs = `${nowSec - 900}.000100`
const replyTs = `${nowSec - 600}.000200`

async function send(event: Record<string, unknown>) {
  const body = JSON.stringify({ type: 'event_callback', event })
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = 'v0=' + createHmac('sha256', 'test-slack-secret').update(`v0:${timestamp}:${body}`).digest('hex')
  const response = await POST(
    new Request('http://localhost:3000/api/webhooks/slack', {
      method: 'POST',
      headers: new Headers({
        'content-type': 'application/json',
        'x-slack-signature': signature,
        'x-slack-request-timestamp': timestamp,
      }),
      body,
    }) as unknown as NextRequest
  )
  expect(response.status).toBe(200)
  await Promise.all(afterWork.splice(0))
}

describe('Slack webhook: gap-fill', () => {
  const supabase = getTestSupabaseAdminClient()
  const infoSpy = vi.spyOn(console, 'info')

  const cleanup = async () => {
    await supabase.from('chat_channels').delete().eq('slack_channel_id', channelId)
    await supabase.schema('bronze').from('slack_reactions').delete().eq('channel_id', channelId)
    await supabase.schema('bronze').from('slack_messages').delete().eq('channel_id', channelId)
  }

  beforeEach(async () => {
    await cleanup()
    fillMessageGap.mockReset()
    fillMessageGap.mockResolvedValue({ claimed: false, messages: 0, reactions: 0 })
    fillThreadIfRootMissing.mockReset()
    fillThreadIfRootMissing.mockResolvedValue({ claimed: false, messages: 0, reactions: 0 })
    infoSpy.mockClear()
  })
  afterEach(cleanup)
  afterAll(cleanup)

  /** A conversation the chat mirrors, so a message in it is projected. */
  async function mirrorChannel() {
    const { error } = await supabase
      .from('chat_channels')
      .insert({ kind: 'channel', visibility: 'public', name: 'gap-fill-test', slack_channel_id: channelId })
    if (error) throw error
  }

  const reaction = { type: 'reaction_added', user: 'UREACTOR', reaction: 'tada', event_ts: `${nowSec}.000300` }

  it('fetches the message when a reaction arrives for one the chat does not have', async () => {
    await mirrorChannel()
    await send({ ...reaction, item: { type: 'message', channel: channelId, ts: rootTs } })

    expect(fillMessageGap).toHaveBeenCalledTimes(1)
    expect(fillMessageGap).toHaveBeenCalledWith(expect.anything(), { channelId, ts: rootTs, source: 'webhook' })
    expect(fillThreadIfRootMissing).not.toHaveBeenCalled()
  })

  it('says so in the log when a fill recovered something, or failed', async () => {
    await mirrorChannel()
    fillMessageGap.mockResolvedValueOnce({ claimed: true, messages: 1, reactions: 3 })
    await send({ ...reaction, item: { type: 'message', channel: channelId, ts: rootTs } })
    expect(infoSpy).toHaveBeenCalledWith('[chat] gap-fill from a webhook event recovered %d messages and %d reactions%s', 1, 3, '')

    fillMessageGap.mockResolvedValueOnce({ claimed: true, messages: 0, reactions: 0, error: 'not_in_channel' })
    await send({ ...reaction, item: { type: 'message', channel: channelId, ts: rootTs } })
    expect(infoSpy).toHaveBeenCalledWith('[chat] gap-fill from a webhook event recovered %d messages and %d reactions%s', 0, 0, ' (failed: not_in_channel)')
  })

  it('fetches the thread when a reply arrives and its root is not in the chat', async () => {
    await mirrorChannel()
    await send({ type: 'message', channel: channelId, user: 'UREPLIER', text: 'a reply', ts: replyTs, thread_ts: rootTs })

    expect(fillThreadIfRootMissing).toHaveBeenCalledWith(expect.anything(), { channelId, threadTs: rootTs, source: 'webhook' })
    expect(fillMessageGap).not.toHaveBeenCalled()
  })

  it('fetches nothing for a new top-level message the chat takes in', async () => {
    await mirrorChannel()
    await send({ type: 'message', channel: channelId, user: 'UPOSTER', text: 'hello', ts: rootTs })

    expect(fillMessageGap).not.toHaveBeenCalled()
    expect(fillThreadIfRootMissing).not.toHaveBeenCalled()
  })

  it('fetches nothing for a message that was deleted: there is nothing to fetch', async () => {
    await mirrorChannel()
    await send({ type: 'message', subtype: 'message_deleted', channel: channelId, deleted_ts: rootTs, event_ts: `${nowSec}.000400` })

    expect(fillMessageGap).not.toHaveBeenCalled()
    expect(fillThreadIfRootMissing).not.toHaveBeenCalled()
  })
})
