import { describe, it, expect, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { createHmac } from 'crypto'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { POST } from '@/app/api/webhooks/slack/route'

/**
 * A DM message delivered on behalf of a member (`user_events`, an authorization that isn't the bot) is kept only for
 * a member the slack_dm_bridge feature covers; with nobody covered nothing is stored. A DM with the bot (a bot
 * authorization), and events naming nobody, are handled as they always were.
 */
const pendingAfter: Promise<unknown>[] = []
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (callback: () => void | Promise<void>) => {
      pendingAfter.push(Promise.resolve().then(callback))
    },
  }
})
vi.mock('@/lib/slack-activity-projection', () => ({ projectSlackActivity: vi.fn(() => Promise.resolve({ messages: 0, reactions: 0 })) }))

const nowSec = Math.floor(Date.now() / 1000)
const tag = Date.now()

async function send(payload: Record<string, unknown>) {
  const body = JSON.stringify({ type: 'event_callback', ...payload })
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = 'v0=' + createHmac('sha256', 'test-slack-secret').update(`v0:${timestamp}:${body}`).digest('hex')
  const response = await POST(
    new Request('http://localhost:3000/api/webhooks/slack', {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json', 'x-slack-signature': signature, 'x-slack-request-timestamp': timestamp }),
      body,
    }) as unknown as NextRequest
  )
  expect(response.status).toBe(200)
  await Promise.allSettled(pendingAfter.splice(0))
}

describe('Slack webhook: DM messages delivered on behalf of a user', () => {
  const supabase = getTestSupabaseAdminClient()
  const stored = async (channel: string) => {
    const { data, error } = await supabase.schema('bronze').from('slack_messages').select('message_ts').eq('channel_id', channel)
    if (error) throw error
    return data.map((r) => r.message_ts)
  }
  const dmEvent = (channel: string, ts: string) => ({ type: 'message', channel, channel_type: 'im', user: 'UPGTAPDM', text: 'private words', ts })

  it("stores nothing when no member the feature covers can see the DM", async () => {
    const channel = `DUSER${tag}`
    await send({ event: dmEvent(channel, `${nowSec}.000100`), authorizations: [{ user_id: 'UPGTAPNOBODY', is_bot: false }] })
    expect(await stored(channel)).toEqual([])
  })

  it("still stores a DM with the bot, which arrives as a bot event", async () => {
    const channel = `DBOT${tag}`
    await send({ event: dmEvent(channel, `${nowSec}.000200`), authorizations: [{ user_id: 'UPGTAPBOT', is_bot: true }] })
    expect(await stored(channel)).toEqual([`${nowSec}.000200`])
  })

  it("handles an event that names nobody as before", async () => {
    const channel = `DNONE${tag}`
    await send({ event: dmEvent(channel, `${nowSec}.000300`) })
    expect(await stored(channel)).toEqual([`${nowSec}.000300`])
  })

  describe('reactions', () => {
    const reactions = async (channel: string) => {
      const { data, error } = await supabase.schema('bronze').from('slack_reactions').select('reaction').eq('channel_id', channel)
      if (error) throw error
      return data.map((r) => r.reaction)
    }
    const reactionEvent = (channel: string) => ({ type: 'reaction_added', user: 'UPGTAPDM', reaction: 'tada', item: { type: 'message', channel, ts: `${nowSec}.000400` }, event_ts: `${nowSec}.000500` })

    it('stores nothing for a reaction on a DM that no covered member can see, or one on a channel delivered on a member\'s behalf', async () => {
      const dm = `DRXN${tag}`
      const channel = `CRXN${tag}`
      await send({ event: reactionEvent(dm), authorizations: [{ user_id: 'UPGTAPNOBODY', is_bot: false }] })
      await send({ event: reactionEvent(channel), authorizations: [{ user_id: 'UPGTAPNOBODY', is_bot: false }] })
      expect(await reactions(dm)).toEqual([])
      expect(await reactions(channel)).toEqual([])
    })

    it('still stores the bot\'s own reaction event', async () => {
      const channel = `CRXNBOT${tag}`
      await send({ event: reactionEvent(channel), authorizations: [{ user_id: 'UPGTAPBOT', is_bot: true }] })
      expect(await reactions(channel)).toEqual(['tada'])
    })
  })
})
