import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { createHmac } from 'crypto'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { POST } from '@/app/api/webhooks/slack/route'

/**
 * Message events that aren't plain new messages. Before, every `message`
 * event was upserted as a new row keyed by the event's own ts, so:
 *  - edits/deletes (`message_changed`/`message_deleted`, which carry no
 *    `user`) failed slack_messages.user_id NOT NULL and were lost,
 *  - bot/app posts (bot_id, no user) failed the same way,
 *  - joins/leaves were stored although the import skips them.
 */
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (callback: () => void | Promise<void>) => {
      void callback()
    },
  }
})

vi.mock('@/lib/processing/trigger', () => ({
  triggerReprocessing: vi.fn(() => Promise.resolve({ processed: [] })),
}))

import { triggerReprocessing } from '@/lib/processing/trigger'

const channelId = `CSUBTYPES${Date.now()}`
const nowSec = Math.floor(Date.now() / 1000)
const originalTs = `${nowSec - 600}.000100`

async function send(event: Record<string, unknown>) {
  const body = JSON.stringify({ type: 'event_callback', event: { channel: channelId, ...event } })
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
  return response.json()
}

describe('Slack webhook: message subtypes', () => {
  const supabase = getTestSupabaseAdminClient()
  const errorSpy = vi.spyOn(console, 'error')

  async function rows() {
    const { data, error } = await supabase
      .schema('bronze')
      .from('slack_messages')
      .select('message_ts, user_id, text, message_type, edited_at, deleted_at')
      .eq('channel_id', channelId)
      .order('message_ts')
    if (error) throw error
    return data
  }

  async function storeOriginal() {
    await send({ type: 'message', ts: originalTs, user: 'UAUTHOR', text: 'first draft' })
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    process.env.SLACK_SIGNING_SECRET = 'test-slack-secret'
    await supabase.schema('bronze').from('slack_messages').delete().eq('channel_id', channelId)
  })

  afterAll(async () => {
    await supabase.schema('bronze').from('slack_messages').delete().eq('channel_id', channelId)
  })

  it('applies an edit to the original message instead of storing a new row', async () => {
    await storeOriginal()
    const editTs = `${nowSec - 60}.000900`
    await send({
      type: 'message',
      subtype: 'message_changed',
      hidden: true,
      ts: editTs,
      event_ts: editTs,
      message: { type: 'message', ts: originalTs, user: 'UAUTHOR', text: 'final draft', edited: { user: 'UAUTHOR', ts: editTs } },
      previous_message: { type: 'message', ts: originalTs, user: 'UAUTHOR', text: 'first draft' },
    })

    const stored = await rows()
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ message_ts: originalTs, user_id: 'UAUTHOR', text: 'final draft', deleted_at: null })
    expect(new Date(stored[0].edited_at!).toISOString()).toBe(new Date(parseFloat(editTs) * 1000).toISOString())
    expect(errorSpy).not.toHaveBeenCalledWith('Error upserting Slack message:', expect.anything())
    expect(triggerReprocessing).toHaveBeenCalledWith('slack_messages', 'bronze', expect.anything())
  })

  it('ignores an edit to a message we never stored (the nightly import brings it in)', async () => {
    await send({
      type: 'message',
      subtype: 'message_changed',
      hidden: true,
      ts: `${nowSec}.000001`,
      message: { type: 'message', ts: `${nowSec - 900}.000001`, user: 'UAUTHOR', text: 'edited' },
    })
    expect(await rows()).toEqual([])
  })

  it('soft-deletes the original message on message_deleted', async () => {
    await storeOriginal()
    const deleteTs = `${nowSec - 30}.000500`
    await send({
      type: 'message',
      subtype: 'message_deleted',
      hidden: true,
      ts: deleteTs,
      event_ts: deleteTs,
      deleted_ts: originalTs,
      previous_message: { type: 'message', ts: originalTs, user: 'UAUTHOR', text: 'first draft' },
    })

    const [row] = await rows()
    expect(row.message_ts).toBe(originalTs)
    expect(row.text).toBe('first draft')
    expect(new Date(row.deleted_at!).toISOString()).toBe(new Date(parseFloat(deleteTs) * 1000).toISOString())
    expect(await rows()).toHaveLength(1)
    expect(triggerReprocessing).toHaveBeenCalled()
  })

  it('keeps the first deleted_at if a delete is delivered twice', async () => {
    await storeOriginal()
    const first = `${nowSec - 30}.000500`
    await send({ type: 'message', subtype: 'message_deleted', hidden: true, ts: first, event_ts: first, deleted_ts: originalTs })
    const second = `${nowSec - 10}.000500`
    await send({ type: 'message', subtype: 'message_deleted', hidden: true, ts: second, event_ts: second, deleted_ts: originalTs })

    const [row] = await rows()
    expect(new Date(row.deleted_at!).toISOString()).toBe(new Date(parseFloat(first) * 1000).toISOString())
  })

  it("ignores a delete event for a message beyond Slack's history limit: the Hub's copy is the archive", async () => {
    // Nobody can delete a message Slack no longer shows them, so this can
    // only be Slack clearing out old data.
    const day = 24 * 60 * 60
    const oldTs = `${nowSec - 120 * day}.000100`
    const { error } = await supabase.schema('bronze').from('slack_messages').insert({
      channel_id: channelId,
      message_ts: oldTs,
      user_id: 'UAUTHOR',
      text: 'from the archive',
      message_type: 'message',
      occurred_at: new Date((nowSec - 120 * day) * 1000).toISOString(),
      raw_payload: {},
    })
    expect(error).toBeNull()

    const deleteTs = `${nowSec - 30}.000500`
    await send({ type: 'message', subtype: 'message_deleted', hidden: true, ts: deleteTs, event_ts: deleteTs, deleted_ts: oldTs })

    const [row] = await rows()
    expect(row).toMatchObject({ message_ts: oldTs, text: 'from the archive', deleted_at: null })
    expect(triggerReprocessing).not.toHaveBeenCalled()
  })

  it('stores a bot/app post under its bot_id, like the import does', async () => {
    const botTs = `${nowSec - 120}.000300`
    await send({ type: 'message', ts: botTs, bot_id: 'BDEPLOYBOT', text: '' })

    expect(await rows()).toEqual([
      { message_ts: botTs, user_id: 'BDEPLOYBOT', text: '', message_type: 'message', edited_at: null, deleted_at: null },
    ])
  })

  it('stores file shares and thread broadcasts with their subtype', async () => {
    await send({ type: 'message', subtype: 'file_share', ts: `${nowSec - 50}.000001`, user: 'UAUTHOR', text: 'pic', files: [{ id: 'F1' }] })
    await send({ type: 'message', subtype: 'thread_broadcast', ts: `${nowSec - 40}.000001`, user: 'UAUTHOR', text: 'also here', thread_ts: originalTs })

    expect((await rows()).map((r) => r.message_type)).toEqual(['file_share', 'thread_broadcast'])
  })

  it.each(['channel_join', 'channel_leave', 'channel_topic', 'bot_message'])('skips %s, which the import skips too', async (subtype) => {
    await send({ type: 'message', subtype, ts: `${nowSec - 20}.000001`, user: 'UAUTHOR', text: 'has joined the channel' })
    expect(await rows()).toEqual([])
    expect(triggerReprocessing).not.toHaveBeenCalled()
  })
})
