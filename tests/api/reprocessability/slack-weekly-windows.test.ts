import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'

/**
 * /api/process/slack rebuilds Slack activities one week per database call
 * (one call for the 90-day import ran past Postgres's statement timeout).
 * Splitting must not change the result: across a range of several weeks the
 * rebuild creates each activity exactly once (including messages right at a
 * week's edge), is idempotent, removes the activities of a week whose
 * messages were all deleted, and still leaves everything alone when Bronze
 * has nothing for the whole range.
 */
describe('Slack reprocessing in weekly windows', () => {
  const supabase = getTestSupabaseAdminClient()
  const memberId = '00000000-0000-0000-0000-0000000000b7'
  const slackUserId = 'U_TEST_WEEKLY'
  const email = 'slack-weekly@example.com'
  const range = { fromDate: '2097-03-01T00:00:00.000Z', toDate: '2097-03-22T23:59:59.000Z' }

  // The first window is Mar 1 to Mar 7 23:59:59.999; the second starts Mar 8 00:00:00.000.
  const messages = [
    { ts: 'WEEKLY_1', at: '2097-03-02T10:00:00.000Z' },
    { ts: 'WEEKLY_EDGE_END', at: '2097-03-07T23:59:59.999Z' },
    { ts: 'WEEKLY_EDGE_START', at: '2097-03-08T00:00:00.000Z' },
    { ts: 'WEEKLY_2', at: '2097-03-10T10:00:00.000Z' },
    { ts: 'WEEKLY_3', at: '2097-03-18T10:00:00.000Z' },
  ]
  const weekTwo = ['WEEKLY_EDGE_START', 'WEEKLY_2']

  async function cleanup() {
    await supabase.schema('bronze').from('slack_reactions').delete().like('message_ts', 'WEEKLY_%')
    await supabase.schema('bronze').from('slack_messages').delete().like('message_ts', 'WEEKLY_%')
    await supabase.from('member_activities').delete().eq('source', 'slack').gte('occurred_at', range.fromDate).lte('occurred_at', range.toDate)
  }

  async function reprocess() {
    const response = await fetch(`${getTestApiBaseUrl()}/api/process/slack`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(range),
    })
    const body = await response.json()
    expect(response.status, JSON.stringify(body)).toBe(200)
    return body
  }

  async function activityKeys() {
    const { data, error } = await supabase
      .from('member_activities')
      .select('activity_type, related_id')
      .eq('source', 'slack')
      .eq('member_id', memberId)
      .gte('occurred_at', range.fromDate)
      .lte('occurred_at', range.toDate)
      .order('occurred_at')
      .order('activity_type')
    expect(error).toBeNull()
    return (data ?? []).map((a) => `${a.activity_type} ${a.related_id}`)
  }

  beforeAll(async () => {
    await cleanup()
    await supabase.schema('bronze').from('slack_users').delete().eq('user_id', slackUserId)
    await supabase.from('members').delete().eq('id', memberId)
    const { error: memberError } = await supabase
      .from('members')
      .insert({ id: memberId, email, name: 'Weekly Slack Member', joined_at: '2022-01-01', status: 'active' })
    if (memberError) throw memberError
    const now = new Date().toISOString()
    const { error: userError } = await supabase.schema('bronze').from('slack_users').insert({
      user_id: slackUserId, email, name: 'weekly_user', display_name: 'Weekly User', real_name: 'Weekly Slack Member',
      is_bot: false, is_deleted: false, imported_at: now, raw_payload: {},
    })
    if (userError) throw userError
    const { error: messageError } = await supabase.schema('bronze').from('slack_messages').insert(
      messages.map((m) => ({
        message_ts: m.ts, channel_id: 'C_WEEKLY', channel_name: 'weekly-test', channel_type: 'public_channel',
        user_id: slackUserId, text: `message ${m.ts}`, message_type: 'message', occurred_at: m.at, imported_at: now, raw_payload: {},
      }))
    )
    if (messageError) throw messageError
    const { error: reactionError } = await supabase.schema('bronze').from('slack_reactions').insert({
      message_ts: 'WEEKLY_3', channel_id: 'C_WEEKLY', channel_name: 'weekly-test', reaction: 'tada',
      user_id: slackUserId, occurred_at: '2097-03-18T10:05:00.000Z', imported_at: now, raw_payload: {},
    })
    if (reactionError) throw reactionError
  })

  afterAll(async () => {
    await cleanup()
    await supabase.schema('bronze').from('slack_users').delete().eq('user_id', slackUserId)
    await supabase.from('members').delete().eq('id', memberId)
  })

  const allKeys = [
    'slack_message C_WEEKLY:WEEKLY_1',
    'slack_message C_WEEKLY:WEEKLY_EDGE_END',
    'slack_message C_WEEKLY:WEEKLY_EDGE_START',
    'slack_message C_WEEKLY:WEEKLY_2',
    'slack_message C_WEEKLY:WEEKLY_3',
    'slack_reaction C_WEEKLY:WEEKLY_3',
  ]

  it('creates each activity exactly once across several weeks, including at a week edge', async () => {
    const body = await reprocess()
    expect(body.processed).toMatchObject({ messages: 5, reactions: 1, total_activities: 6 })
    expect(await activityKeys()).toEqual(allKeys)
  })

  it('is idempotent: reprocessing the same range leaves the same activities', async () => {
    await reprocess()
    await reprocess()
    expect(await activityKeys()).toEqual(allKeys)
  })

  it('removes the activities of a week whose messages were all deleted in Slack', async () => {
    await reprocess()
    await supabase.schema('bronze').from('slack_messages').update({ deleted_at: new Date().toISOString() }).in('message_ts', weekTwo)

    await reprocess()

    expect(await activityKeys()).toEqual(allKeys.filter((k) => !weekTwo.some((ts) => k.endsWith(`:${ts}`))))
  })

  it('leaves existing activities alone when Bronze has nothing for the whole range', async () => {
    const before = await activityKeys()
    expect(before.length).toBeGreaterThan(0)
    await supabase.schema('bronze').from('slack_messages').update({ deleted_at: new Date().toISOString() }).like('message_ts', 'WEEKLY_%')
    await supabase.schema('bronze').from('slack_reactions').update({ removed_at: new Date().toISOString() }).like('message_ts', 'WEEKLY_%')

    const body = await reprocess()

    expect(body.processed.total_activities).toBe(0)
    expect(await activityKeys()).toEqual(before)
  })
})
