import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { useFakeClock } from '../../helpers/fake-clock'

/**
 * Channel membership history (bronze.slack_channel_member_events and the
 * periods view over it). Slack has no membership-history API, so the import
 * records it from two places: the "joined the channel" / "left the channel"
 * notices in channel history (exact time, who invited them), and the member
 * list for changes nobody announced. The webhook adds live events. Slack is
 * mocked, the local DB is real.
 */
const suffix = Date.now()
const channelId = `TEST_HISTORY_CHAN_${suffix}`
const alice = `TEST_HISTORY_ALICE_${suffix}`
const bob = `TEST_HISTORY_BOB_${suffix}`
const cara = `TEST_HISTORY_CARA_${suffix}`
const nowSec = Math.floor(Date.now() / 1000)
const day = 24 * 60 * 60
const tsAgo = (seconds: number, n: number) => `${nowSec - seconds}.${String(n).padStart(6, '0')}`
const iso = (ts: string) => new Date(parseFloat(ts) * 1000).toISOString()

type SlackMsg = Record<string, any>
const slack: { history: SlackMsg[]; members: string[] } = { history: [], members: [] }

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    users = {
      list: async () => ({
        members: [alice, bob, cara].map((id) => ({ id, name: id.toLowerCase(), real_name: id, profile: {} })),
      }),
    }
    emoji = {
      list: async () => {
        throw Object.assign(new Error('missing_scope'), { data: { error: 'missing_scope' } })
      },
    }
    conversations = {
      list: async ({ types }: { types?: string }) => ({
        channels: types === 'mpim' ? [] : [{ id: channelId, name: 'history-test', is_private: false, is_archived: false, is_member: true }],
      }),
      join: async () => ({ ok: true }),
      members: async () => ({ members: slack.members }),
      history: async () => ({ messages: slack.history }),
      replies: async () => ({ messages: [] }),
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
import { applySlackMembershipEvent } from '@/lib/slack-capture'

const supabase = getTestSupabaseAdminClient()
const bronze = (table: string) => supabase.schema('bronze').from(table)

async function cleanup() {
  await bronze('slack_channel_member_events').delete().eq('channel_id', channelId)
  await bronze('slack_channel_members').delete().eq('channel_id', channelId)
  await bronze('slack_reactions').delete().eq('channel_id', channelId)
  await bronze('slack_messages').delete().eq('channel_id', channelId)
  await bronze('slack_channels').delete().eq('channel_id', channelId)
  await bronze('slack_users').delete().in('user_id', [alice, bob, cara])
}

async function runImport() {
  const response = await POST(
    new NextRequest('http://localhost/api/import/slack-api', { method: 'POST', body: JSON.stringify({ daysBack: 90 }) })
  )
  const body = await response.json()
  expect(response.status, JSON.stringify(body)).toBe(200)
  expect(body.capture.errors).toEqual([])
  return body
}

async function events() {
  const { data, error } = await bronze('slack_channel_member_events')
    .select('user_id, event, source, occurred_at, inviter_user_id')
    .eq('channel_id', channelId)
    .order('occurred_at')
    .order('user_id')
  if (error) throw error
  return data ?? []
}
const summary = async () => (await events()).map((e) => `${e.user_id === alice ? 'alice' : e.user_id === bob ? 'bob' : 'cara'} ${e.event} ${e.source}`)

async function periods(userId: string) {
  const { data, error } = await bronze('slack_channel_membership_periods')
    .select('joined_at, joined_source, left_at, left_source, inviter_user_id')
    .eq('channel_id', channelId)
    .eq('user_id', userId)
    .order('joined_at')
  if (error) throw error
  return data ?? []
}

const joinNotice = (user: string, ts: string, inviter?: string) => ({ ts, user, subtype: 'channel_join', text: `<@${user}> has joined the channel`, inviter })
const leaveNotice = (user: string, ts: string) => ({ ts, user, subtype: 'channel_leave', text: `<@${user}> has left the channel` })

describe('Slack import: channel membership history', () => {
  const fake = useFakeClock()

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: 'admin' } as any, forbidden: false, supabase } as any)
    slack.history = []
    slack.members = [alice, bob]
    await cleanup()
  })

  afterAll(cleanup)

  it('starts with an inferred join for everyone already in the channel, once', async () => {
    const body = await runImport()

    expect(await summary()).toEqual(['alice joined member_list', 'bob joined member_list'])
    expect(body.capture.membership.eventsInferred).toBe(2)

    const again = await runImport()
    expect(again.capture.membership.eventsInferred).toBe(0)
    expect(await events()).toHaveLength(2)
  })

  it('records a join notice with its real time and inviter, instead of inferring one', async () => {
    const joinedTs = tsAgo(10 * day, 1)
    slack.history = [joinNotice(bob, joinedTs, alice)]

    await runImport()

    const all = await events()
    expect(all.map((e) => `${e.user_id === bob ? 'bob' : 'alice'} ${e.event} ${e.source}`).sort()).toEqual([
      'alice joined member_list',
      'bob joined history_notice',
    ])
    const bobJoin = all.find((e) => e.user_id === bob)!
    expect(new Date(bobJoin.occurred_at).toISOString()).toBe(iso(joinedTs))
    expect(bobJoin.inviter_user_id).toBe(alice)

    // The notice is not stored as a message.
    const { data: messages } = await bronze('slack_messages').select('message_ts').eq('channel_id', channelId)
    expect(messages).toEqual([])

    // Fetching the same notice again changes nothing.
    await runImport()
    expect(await events()).toHaveLength(2)
  })

  it('keeps a leave and a rejoin as two periods', async () => {
    const firstJoin = tsAgo(30 * day, 1)
    const left = tsAgo(20 * day, 2)
    const rejoined = tsAgo(5 * day, 3)
    slack.history = [joinNotice(bob, firstJoin, alice), leaveNotice(bob, left), joinNotice(bob, rejoined)]

    await runImport()

    const bobPeriods = await periods(bob)
    expect(bobPeriods.map((p) => [new Date(p.joined_at).toISOString(), p.left_at && new Date(p.left_at).toISOString()])).toEqual([
      [iso(firstJoin), iso(left)],
      [iso(rejoined), null],
    ])
    expect(bobPeriods[0]).toMatchObject({ joined_source: 'history_notice', left_source: 'history_notice', inviter_user_id: alice })
  })

  it('uses an announced leave as it is, and infers one nobody announced', async () => {
    await runImport() // alice and bob in
    fake.clock.advance(day * 1000)

    // Bob leaves with a notice; cara was never in; alice vanishes without one.
    const leftTs = `${Math.floor(fake.clock.now() / 1000) - 60}.000001`
    slack.history = [leaveNotice(bob, leftTs)]
    slack.members = []
    const body = await runImport()

    expect(await summary()).toEqual([
      'alice joined member_list',
      'bob joined member_list',
      'bob left history_notice',
      'alice left member_list',
    ])
    expect(body.capture.membership.eventsInferred).toBe(1)
    const [bobPeriod] = await periods(bob)
    expect(new Date(bobPeriod.left_at).toISOString()).toBe(iso(leftTs))
  })

  it('infers a rejoin nobody announced, dated from when it was noticed', async () => {
    await runImport()
    slack.members = [alice]
    fake.clock.advance(day * 1000)
    await runImport() // bob gone
    slack.members = [alice, bob]
    fake.clock.advance(day * 1000)
    await runImport() // bob back

    expect((await summary()).filter((s) => s.startsWith('bob'))).toEqual([
      'bob joined member_list',
      'bob left member_list',
      'bob joined member_list',
    ])
    const bobPeriods = await periods(bob)
    expect(bobPeriods).toHaveLength(2)
    expect(bobPeriods[1].left_at).toBeNull()
    expect(Date.parse(bobPeriods[1].joined_at)).toBeGreaterThan(Date.parse(bobPeriods[0].left_at))
  })

  it('records live join and leave events from the webhook, once each', async () => {
    const joinedTs = tsAgo(120, 1)
    const leftTs = tsAgo(60, 2)
    const join = { type: 'member_joined_channel', channel: channelId, user: cara, inviter: alice, event_ts: joinedTs }
    await applySlackMembershipEvent(supabase, join)
    await applySlackMembershipEvent(supabase, join) // redelivered
    await applySlackMembershipEvent(supabase, { type: 'member_left_channel', channel: channelId, user: cara, event_ts: leftTs })

    expect(await summary()).toEqual(['cara joined webhook', 'cara left webhook'])
    const [caraPeriod] = await periods(cara)
    expect(caraPeriod).toMatchObject({ joined_source: 'webhook', left_source: 'webhook', inviter_user_id: alice })
    expect(new Date(caraPeriod.joined_at).toISOString()).toBe(iso(joinedTs))
    expect(new Date(caraPeriod.left_at).toISOString()).toBe(iso(leftTs))
  })
})
