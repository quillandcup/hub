import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'

/**
 * /api/import/slack-api with Slack mocked and the local DB real: thread replies
 * are fetched (conversations.history only returns top-level messages), a
 * thread_broadcast reply seen in both places is saved once, reactions removed
 * from a reply are deleted, and members are rebuilt for the Slack users.
 */
const suffix = Date.now()
const channelId = `TEST_CHANNEL_THREADS_${suffix}`
const userId = `TEST_USER_THREADS_${suffix}`
const nowSec = Math.floor(Date.now() / 1000)
const parentTs = `${nowSec - 300}.000100`
const replyTs = `${nowSec - 200}.000200`
const broadcastTs = `${nowSec - 100}.000300`

const parent = {
  ts: parentTs,
  user: userId,
  text: 'thread parent',
  thread_ts: parentTs,
  reply_count: 2,
  reactions: [{ name: 'heart', users: [userId], count: 1 }],
}
const reply = {
  ts: replyTs,
  user: userId,
  text: 'a reply',
  thread_ts: parentTs,
  reactions: [{ name: 'tada', users: [userId], count: 1 }],
}
const broadcast = { ts: broadcastTs, user: userId, text: 'also sent to channel', thread_ts: parentTs, subtype: 'thread_broadcast' }

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    users = {
      list: async () => ({ members: [{ id: userId, name: 'threads-test', real_name: 'Threads Test', profile: {} }] }),
    }
    conversations = {
      list: async () => ({ channels: [{ id: channelId, name: 'threads-test', is_private: false, is_archived: false }] }),
      join: async () => ({ ok: true }),
      history: async () => ({ messages: [broadcast, parent] }),
      replies: async ({ ts }: { ts: string }) => ({ messages: ts === parentTs ? [parent, reply, broadcast] : [] }),
    }
  },
}))

vi.mock('@/lib/supabase/api-auth', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/processing/trigger', () => ({ triggerReprocessing: vi.fn(async () => ({ processed: [] })) }))

import { requireAdmin } from '@/lib/supabase/api-auth'
import { triggerReprocessing } from '@/lib/processing/trigger'
import { POST } from '@/app/api/import/slack-api/route'

describe('POST /api/import/slack-api thread replies', () => {
  const supabase = getTestSupabaseAdminClient()

  const cleanup = async () => {
    await supabase.schema('bronze').from('slack_reactions').delete().eq('channel_id', channelId)
    await supabase.schema('bronze').from('slack_messages').delete().eq('channel_id', channelId)
    await supabase.schema('bronze').from('slack_channels').delete().eq('channel_id', channelId)
    await supabase.schema('bronze').from('slack_users').delete().eq('user_id', userId)
  }

  const runImport = async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/import/slack-api', { method: 'POST', body: JSON.stringify({ daysBack: 1 }) })
    )
    const body = await response.json()
    expect(response.status, JSON.stringify(body)).toBe(200)
    return body
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: 'admin' } as any, forbidden: false, supabase } as any)
    await cleanup()
  })

  afterAll(cleanup)

  it('saves each thread reply once, with its reactions', async () => {
    const body = await runImport()

    const { data: messages } = await supabase
      .schema('bronze')
      .from('slack_messages')
      .select('message_ts, thread_ts, message_type')
      .eq('channel_id', channelId)
      .order('message_ts')
    expect(messages).toEqual([
      { message_ts: parentTs, thread_ts: parentTs, message_type: 'message' },
      { message_ts: replyTs, thread_ts: parentTs, message_type: 'message' },
      { message_ts: broadcastTs, thread_ts: parentTs, message_type: 'thread_broadcast' },
    ])
    expect(body.fetched.messages).toBe(3)

    const { data: reactions } = await supabase
      .schema('bronze')
      .from('slack_reactions')
      .select('message_ts, reaction')
      .eq('channel_id', channelId)
      .order('message_ts')
    expect(reactions).toEqual([
      { message_ts: parentTs, reaction: 'heart' },
      { message_ts: replyTs, reaction: 'tada' },
    ])
  })

  it('deletes a reaction that was removed from a reply', async () => {
    await supabase.schema('bronze').from('slack_reactions').insert({
      channel_id: channelId,
      message_ts: replyTs,
      reaction: 'eyes',
      user_id: userId,
      occurred_at: new Date().toISOString(),
      raw_payload: {},
    })

    const body = await runImport()

    const { data: reactions } = await supabase
      .schema('bronze')
      .from('slack_reactions')
      .select('reaction')
      .eq('channel_id', channelId)
      .eq('message_ts', replyTs)
    expect(reactions).toEqual([{ reaction: 'tada' }])
    expect(body.imported.reactionsRemoved).toBe(1)
  })

  it('rebuilds members for the Slack users, then processes Slack activity', async () => {
    await runImport()

    const calls = vi.mocked(triggerReprocessing).mock.calls.map(([table]) => table)
    expect(calls).toEqual(['slack_users', 'slack_messages'])
  })
})
