import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'

/**
 * /api/import/slack-api only fetches replies for threads that need it, and
 * stops starting new threads when its time budget runs out.
 *
 * Regression: once replies were imported, the nightly 90-day reconcile made
 * one conversations.replies call for each of ~630 threads, Slack rate-limited
 * them (retry-after 10s), and /api/reconcile/slack hit the 300s limit two
 * nights running.
 */
const suffix = Date.now()
const channelId = `TEST_CHANNEL_THREADSEL_${suffix}`
const userId = `TEST_USER_THREADSEL_${suffix}`
const nowSec = Math.floor(Date.now() / 1000)
const day = 24 * 60 * 60

type SlackMsg = Record<string, any>
// Mutable per test: what conversations.history / replies return.
const slackState: { history: SlackMsg[]; replies: Map<string, SlackMsg[]>; onReplies?: () => void } = {
  history: [],
  replies: new Map(),
}
const repliesCalls: string[] = []

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    users = {
      list: async () => ({ members: [{ id: userId, name: 'threadsel-test', real_name: 'Thread Sel', profile: {} }] }),
    }
    conversations = {
      list: async () => ({ channels: [{ id: channelId, name: 'threadsel-test', is_private: false, is_archived: false, is_member: true }] }),
      join: async () => ({ ok: true }),
      history: async () => ({ messages: slackState.history }),
      replies: async ({ ts }: { ts: string }) => {
        repliesCalls.push(ts)
        slackState.onReplies?.()
        return { messages: slackState.replies.get(ts) ?? [] }
      },
    }
  },
}))

vi.mock('@/lib/supabase/api-auth', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/processing/trigger', () => ({ triggerReprocessing: vi.fn(async () => ({ processed: [] })) }))

import { requireAdmin } from '@/lib/supabase/api-auth'
import { POST } from '@/app/api/import/slack-api/route'

/** A thread: parent (as history returns it) plus its replies (as replies returns them). */
function makeThread(label: number, parentAgeDays: number, replyAgesDays: number[]) {
  const parentTs = `${nowSec - parentAgeDays * day}.${String(label).padStart(6, '0')}`
  const replies = replyAgesDays.map((age, i) => ({
    ts: `${nowSec - age * day}.${String(label * 100 + i + 1).padStart(6, '0')}`,
    user: userId,
    text: `reply ${i}`,
    thread_ts: parentTs,
  }))
  const parent = {
    ts: parentTs,
    user: userId,
    text: `parent ${label}`,
    thread_ts: parentTs,
    reply_count: replies.length,
    latest_reply: replies[replies.length - 1]?.ts,
  }
  return { parent, replies, parentTs }
}

function serve(threads: ReturnType<typeof makeThread>[]) {
  slackState.history = threads.map((t) => t.parent)
  slackState.replies = new Map(threads.map((t) => [t.parentTs, [t.parent, ...t.replies]]))
}

describe('POST /api/import/slack-api thread selection', () => {
  const supabase = getTestSupabaseAdminClient()

  const cleanup = async () => {
    await supabase.schema('bronze').from('slack_reactions').delete().eq('channel_id', channelId)
    await supabase.schema('bronze').from('slack_messages').delete().eq('channel_id', channelId)
    await supabase.schema('bronze').from('slack_channels').delete().eq('channel_id', channelId)
    await supabase.schema('bronze').from('slack_users').delete().eq('user_id', userId)
  }

  const runImport = async () => {
    repliesCalls.length = 0
    const response = await POST(
      new NextRequest('http://localhost/api/import/slack-api', { method: 'POST', body: JSON.stringify({ daysBack: 90 }) })
    )
    const body = await response.json()
    expect(response.status, JSON.stringify(body)).toBe(200)
    return body
  }

  const storedReplyTs = async (parentTs: string) => {
    const { data } = await supabase
      .schema('bronze')
      .from('slack_messages')
      .select('message_ts')
      .eq('channel_id', channelId)
      .eq('thread_ts', parentTs)
      .neq('message_ts', parentTs)
      .order('message_ts')
    return (data ?? []).map((r) => r.message_ts)
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['setTimeout'] }) // skip the 1.2s per-channel pause
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: 'admin' } as any, forbidden: false, supabase } as any)
    slackState.onReplies = undefined
    await cleanup()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  afterAll(cleanup)

  async function runImportAdvancingTimers() {
    const pending = runImport()
    await vi.runAllTimersAsync()
    return pending
  }

  it('fetches every thread on the first run, then only changed or recently active ones', async () => {
    const quiet = makeThread(1, 40, [39, 38])
    const active = makeThread(2, 40, [39, 1])
    serve([quiet, active])

    const first = await runImportAdvancingTimers()
    expect(repliesCalls.sort()).toEqual([quiet.parentTs, active.parentTs].sort())
    expect(first.fetched.threadsFetched).toBe(2)
    expect(await storedReplyTs(quiet.parentTs)).toEqual(quiet.replies.map((r) => r.ts))

    const second = await runImportAdvancingTimers()
    expect(repliesCalls).toEqual([active.parentTs])
    expect(second.fetched.threadsFetched).toBe(1)
    expect(second.fetched.threadsDeferred).toBe(0)
  })

  it('refetches an old thread once it gets a new reply', async () => {
    const t = makeThread(3, 40, [39])
    serve([t])
    await runImportAdvancingTimers()

    const newReply = { ts: `${nowSec - 20 * day}.000399`, user: userId, text: 'late reply', thread_ts: t.parentTs }
    t.replies.push(newReply)
    t.parent.reply_count = 2
    t.parent.latest_reply = newReply.ts
    serve([t])

    await runImportAdvancingTimers()
    expect(repliesCalls).toEqual([t.parentTs])
    expect(await storedReplyTs(t.parentTs)).toEqual(t.replies.map((r) => r.ts))
  })

  it('keeps reactions on replies of threads it skipped', async () => {
    const t = makeThread(4, 40, [39])
    serve([t])
    await runImportAdvancingTimers()
    await supabase.schema('bronze').from('slack_reactions').insert({
      channel_id: channelId,
      message_ts: t.replies[0].ts,
      reaction: 'heart',
      user_id: userId,
      occurred_at: new Date().toISOString(),
      raw_payload: {},
    })

    const body = await runImportAdvancingTimers()
    expect(repliesCalls).toEqual([])
    expect(body.imported.reactionsRemoved).toBe(0)
    const { data } = await supabase.schema('bronze').from('slack_reactions').select('reaction').eq('message_ts', t.replies[0].ts)
    expect(data).toEqual([{ reaction: 'heart' }])
  })

  it('defers threads past the time budget and picks them up on the next run', async () => {
    const threads = Array.from({ length: 8 }, (_, i) => makeThread(10 + i, 60 - i, [50 - i]))
    serve(threads)

    // Once the first reply call starts, jump past the fetch budget.
    const realNow = Date.now.bind(Date)
    let offset = 0
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset)
    slackState.onReplies = () => {
      offset = 10 * 60 * 1000
    }

    const first = await runImportAdvancingTimers()
    // The clock jumps as the first call starts, so only that thread (the one
    // with the newest reply) is fetched; the other workers see the deadline.
    const newest = threads[threads.length - 1]
    expect(repliesCalls).toEqual([newest.parentTs])
    expect(first.fetched.threadsFetched).toBe(1)
    expect(first.fetched.threadsDeferred).toBe(7)
    expect(await storedReplyTs(newest.parentTs)).toEqual(newest.replies.map((r) => r.ts))
    for (const t of threads.slice(0, -1)) expect(await storedReplyTs(t.parentTs)).toEqual([])

    slackState.onReplies = undefined
    offset = 0
    const second = await runImportAdvancingTimers()
    expect(repliesCalls.sort()).toEqual(threads.slice(0, -1).map((t) => t.parentTs).sort())
    expect(second.fetched.threadsDeferred).toBe(0)
    for (const t of threads) expect(await storedReplyTs(t.parentTs)).toEqual(t.replies.map((r) => r.ts))
  })
})
