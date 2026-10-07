import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { createHmac } from 'crypto'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { POST } from '@/app/api/webhooks/slack/route'

/**
 * A reaction taken back in Slack is soft-deleted (removed_at), not deleted:
 * the row stays as a record that it happened, and readers skip removed rows.
 * Adding the same reaction again makes it live again.
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

const channelId = `CREACTSOFT${Date.now()}`
const nowSec = Math.floor(Date.now() / 1000)
const messageTs = `${nowSec - 600}.000100`

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
}

const reactionEvent = (type: 'reaction_added' | 'reaction_removed', eventTs: string) => ({
  type,
  user: 'UREACTOR',
  reaction: 'tada',
  item: { type: 'message', channel: channelId, ts: messageTs },
  event_ts: eventTs,
})

const iso = (ts: string) => new Date(parseFloat(ts) * 1000).toISOString()

describe('Slack webhook: reactions are soft-deleted', () => {
  const supabase = getTestSupabaseAdminClient()
  const cleanup = () => supabase.schema('bronze').from('slack_reactions').delete().eq('channel_id', channelId)

  async function rows() {
    const { data, error } = await supabase
      .schema('bronze')
      .from('slack_reactions')
      .select('reaction, user_id, removed_at')
      .eq('channel_id', channelId)
    if (error) throw error
    return (data ?? []).map((r) => ({ ...r, removed_at: r.removed_at && new Date(r.removed_at).toISOString() }))
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    process.env.SLACK_SIGNING_SECRET = 'test-slack-secret'
    await cleanup()
  })

  afterAll(cleanup)

  it('keeps the row and records when the reaction was taken back', async () => {
    const removedTs = `${nowSec - 60}.000200`
    await send(reactionEvent('reaction_added', `${nowSec - 120}.000200`))
    await send(reactionEvent('reaction_removed', removedTs))

    expect(await rows()).toEqual([{ reaction: 'tada', user_id: 'UREACTOR', removed_at: iso(removedTs) }])
  })

  it('keeps the first removal time if the event is delivered twice', async () => {
    const removedTs = `${nowSec - 60}.000200`
    await send(reactionEvent('reaction_added', `${nowSec - 120}.000200`))
    await send(reactionEvent('reaction_removed', removedTs))
    await send(reactionEvent('reaction_removed', `${nowSec - 30}.000200`))

    expect((await rows())[0].removed_at).toBe(iso(removedTs))
  })

  it('makes the reaction live again when it is added back', async () => {
    await send(reactionEvent('reaction_added', `${nowSec - 120}.000200`))
    await send(reactionEvent('reaction_removed', `${nowSec - 60}.000200`))
    await send(reactionEvent('reaction_added', `${nowSec - 30}.000200`))

    expect(await rows()).toEqual([{ reaction: 'tada', user_id: 'UREACTOR', removed_at: null }])
  })
})
