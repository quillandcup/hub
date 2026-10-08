import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { useFakeClock } from '../../helpers/fake-clock'

/**
 * The Slack import soft-deletes stored messages that were deleted in Slack,
 * and only those. The Hub keeps Slack messages for good while Slack's API
 * stops returning them after about 90 days, so a message that has merely aged
 * out of Slack's history must never be marked deleted. Slack is mocked, the
 * local DB is real. Rules: lib/slack-deletions.ts.
 */
const suffix = Date.now()
const channelId = `TEST_DELETED_CHAN_${suffix}`
const userId = `TEST_DELETED_USER_${suffix}`
const nowSec = Math.floor(Date.now() / 1000)
const day = 24 * 60 * 60
const tsAgo = (seconds: number, n: number) => `${nowSec - seconds}.${String(n).padStart(6, '0')}`

type SlackMsg = Record<string, any>
const slack: { history: SlackMsg[]; replies: Map<string, SlackMsg[]> } = { history: [], replies: new Map() }
const repliesCalls: string[] = []

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    users = { list: async () => ({ members: [{ id: userId, name: 'deleted-test', real_name: 'Deleted Test', profile: {} }] }) }
    emoji = {
      list: async () => {
        throw Object.assign(new Error('missing_scope'), { data: { error: 'missing_scope' } })
      },
    }
    conversations = {
      list: async ({ types }: { types?: string }) => ({
        channels: types === 'mpim' ? [] : [{ id: channelId, name: 'deleted-test', is_private: false, is_archived: false, is_member: true }],
      }),
      join: async () => ({ ok: true }),
      members: async () => ({ members: [userId] }),
      history: async () => ({ messages: slack.history }),
      replies: async ({ ts }: { ts: string }) => {
        repliesCalls.push(ts)
        return { messages: slack.replies.get(ts) ?? [] }
      },
    }
  },
}))

vi.mock('@/lib/supabase/api-auth', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/processing/trigger', () => ({ triggerReprocessing: vi.fn(async () => ({ processed: [] })) }))
vi.mock('@/lib/supabase/service', async () => {
  const { getTestSupabaseAdminClient } = await import('../../helpers/supabase')
  return { createServiceRoleClient: () => getTestSupabaseAdminClient() }
})

import { requireAdmin } from '@/lib/supabase/api-auth'
import { POST } from '@/app/api/import/slack-api/route'

const supabase = getTestSupabaseAdminClient()
const messagesTable = () => supabase.schema('bronze').from('slack_messages')

async function cleanup() {
  await supabase.schema('bronze').from('slack_channel_members').delete().eq('channel_id', channelId)
  await supabase.schema('bronze').from('slack_channel_member_events').delete().eq('channel_id', channelId)
  await supabase.schema('bronze').from('slack_reactions').delete().eq('channel_id', channelId)
  await messagesTable().delete().eq('channel_id', channelId)
  await supabase.schema('bronze').from('slack_channels').delete().eq('channel_id', channelId)
  await supabase.schema('bronze').from('slack_users').delete().eq('user_id', userId)
}

async function runImport() {
  repliesCalls.length = 0
  const response = await POST(
    new NextRequest('http://localhost/api/import/slack-api', { method: 'POST', body: JSON.stringify({ daysBack: 90 }) })
  )
  const body = await response.json()
  expect(response.status, JSON.stringify(body)).toBe(200)
  return body
}

/** A row as the webhook or an earlier import would have left it. */
async function store(ts: string, ageSeconds: number, extra: Record<string, unknown> = {}) {
  const { error } = await messagesTable().insert({
    channel_id: channelId,
    message_ts: ts,
    user_id: userId,
    text: `stored ${ts}`,
    message_type: 'message',
    occurred_at: new Date((nowSec - ageSeconds) * 1000).toISOString(),
    raw_payload: {},
    ...extra,
  })
  if (error) throw error
}

async function deletedState() {
  const { data, error } = await messagesTable().select('message_ts, deleted_at').eq('channel_id', channelId).order('message_ts')
  if (error) throw error
  return Object.fromEntries((data ?? []).map((m) => [m.message_ts, m.deleted_at === null ? 'live' : 'deleted']))
}

const msg = (ts: string, extra: SlackMsg = {}) => ({ ts, user: userId, text: `slack ${ts}`, ...extra })

describe('Slack import: messages deleted in Slack', () => {
  useFakeClock()

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: 'admin' } as any, forbidden: false, supabase } as any)
    slack.history = []
    slack.replies = new Map()
    await cleanup()
  })

  afterAll(cleanup)

  it('soft-deletes a message Slack no longer returns, and nothing else', async () => {
    const kept = tsAgo(5 * day, 1)
    const gone = tsAgo(6 * day, 2)
    await store(kept, 5 * day)
    await store(gone, 6 * day)
    slack.history = [msg(kept)]

    const body = await runImport()

    expect(await deletedState()).toEqual({ [kept]: 'live', [gone]: 'deleted' })
    expect(body.capture.deletions).toMatchObject({ deleted: 1, suspiciousChannels: [] })
    expect(body.capture.errors).toEqual([])

    // The text is kept: it is a soft delete.
    const { data } = await messagesTable().select('text').eq('channel_id', channelId).eq('message_ts', gone).single()
    expect(data?.text).toBe(`stored ${gone}`)
  })

  it("never marks a message that has aged out of Slack's history", async () => {
    const recent = tsAgo(5 * day, 1)
    const nearEdge = tsAgo(85 * day, 2)
    const pastEdge = tsAgo(120 * day, 3)
    const ancient = tsAgo(400 * day, 4)
    await store(recent, 5 * day)
    await store(nearEdge, 85 * day)
    await store(pastEdge, 120 * day)
    await store(ancient, 400 * day)
    // Slack returns only what it still has.
    slack.history = [msg(recent)]

    const body = await runImport()

    expect(await deletedState()).toEqual({ [recent]: 'live', [nearEdge]: 'live', [pastEdge]: 'live', [ancient]: 'live' })
    expect(body.capture.deletions.deleted).toBe(0)
  })

  it('does not mark a message the webhook stored moments before the fetch', async () => {
    const justNow = tsAgo(120, 1)
    await store(justNow, 120)
    slack.history = []

    await runImport()

    expect(await deletedState()).toEqual({ [justNow]: 'live' })
  })

  it('does not mark a stored row Slack still returns but the import does not keep', async () => {
    const topicChange = tsAgo(5 * day, 1)
    await store(topicChange, 5 * day)
    slack.history = [msg(topicChange, { subtype: 'channel_topic' })]

    await runImport()

    expect(await deletedState()).toEqual({ [topicChange]: 'live' })
  })

  it('marks a deleted reply by fetching the thread that now has fewer replies than we hold', async () => {
    const parent = tsAgo(20 * day, 1)
    const liveReply = tsAgo(19 * day, 2)
    const goneReply = tsAgo(18 * day, 3)
    await store(parent, 20 * day, { thread_ts: parent, reply_count: 2 })
    await store(liveReply, 19 * day, { thread_ts: parent })
    await store(goneReply, 18 * day, { thread_ts: parent })
    const slackParent = msg(parent, { thread_ts: parent, reply_count: 1, latest_reply: liveReply })
    slack.history = [slackParent]
    slack.replies = new Map([[parent, [slackParent, msg(liveReply, { thread_ts: parent })]]])

    await runImport()

    expect(repliesCalls).toEqual([parent])
    expect(await deletedState()).toEqual({ [parent]: 'live', [liveReply]: 'live', [goneReply]: 'deleted' })

    // Now the live replies match Slack's count, so the thread isn't fetched again.
    await runImport()
    expect(repliesCalls).toEqual([])
    expect(await deletedState()).toEqual({ [parent]: 'live', [liveReply]: 'live', [goneReply]: 'deleted' })
  })

  it('marks stored replies to a message Slack says no longer has any', async () => {
    const parent = tsAgo(20 * day, 1)
    const goneReply = tsAgo(19 * day, 2)
    await store(parent, 20 * day, { thread_ts: parent, reply_count: 1 })
    await store(goneReply, 19 * day, { thread_ts: parent })
    slack.history = [msg(parent)]

    await runImport()

    expect(await deletedState()).toEqual({ [parent]: 'live', [goneReply]: 'deleted' })
  })

  it('leaves replies alone when their thread was not fetched this run', async () => {
    // Up to date and not recently active: the import doesn't fetch this thread.
    const parent = tsAgo(20 * day, 1)
    const reply = tsAgo(19 * day, 2)
    await store(parent, 20 * day, { thread_ts: parent, reply_count: 1 })
    await store(reply, 19 * day, { thread_ts: parent })
    slack.history = [msg(parent, { thread_ts: parent, reply_count: 1, latest_reply: reply })]

    await runImport()

    expect(repliesCalls).toEqual([])
    expect(await deletedState()).toEqual({ [parent]: 'live', [reply]: 'live' })
  })

  it('marks a message Slack shows as a tombstone, and keeps its replies', async () => {
    const parent = tsAgo(20 * day, 1)
    const reply = tsAgo(19 * day, 2)
    await store(parent, 20 * day, { thread_ts: parent, reply_count: 1 })
    await store(reply, 19 * day, { thread_ts: parent })
    slack.history = [msg(parent, { subtype: 'tombstone', text: 'This message was deleted.', thread_ts: parent, reply_count: 1, latest_reply: reply })]

    await runImport()

    expect(await deletedState()).toEqual({ [parent]: 'deleted', [reply]: 'live' })
  })

  it('brings a message back if a later import finds it in Slack after all', async () => {
    const ts = tsAgo(5 * day, 1)
    await store(ts, 5 * day)
    slack.history = []
    await runImport()
    expect(await deletedState()).toEqual({ [ts]: 'deleted' })

    slack.history = [msg(ts)]
    await runImport()

    expect(await deletedState()).toEqual({ [ts]: 'live' })
  })

  it('refuses to mark anything, and reports it, when most of a channel goes missing at once', async () => {
    // Far more likely Slack changed what it returns than 15 messages being deleted overnight.
    const stored: string[] = []
    for (let i = 1; i <= 20; i++) {
      const ts = tsAgo(i * day, i)
      stored.push(ts)
      await store(ts, i * day)
    }
    slack.history = stored.slice(0, 5).map((ts) => msg(ts))

    const body = await runImport()

    expect(Object.values(await deletedState())).toEqual(Array(20).fill('live'))
    expect(body.capture.deletions).toMatchObject({ deleted: 0, suspiciousChannels: [{ channel_id: channelId, missing: 15, judged: 20 }] })
    expect(body.capture.errors).toHaveLength(1)
    expect(body.capture.errors[0]).toContain('not marking them deleted')
  })
})
