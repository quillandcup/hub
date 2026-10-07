import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'

/**
 * reprocess_slack_activities_atomic rebuilds the Slack slice of
 * member_activities from Bronze in one transaction. These tests call it
 * directly (slack.test.ts covers the API route on top of it).
 */
describe('reprocess_slack_activities_atomic', () => {
  const supabase = getTestSupabaseAdminClient()
  const memberId = '00000000-0000-0000-0000-0000000000a1'
  const missingMemberId = '00000000-0000-0000-0000-0000000000ff'
  const mappedUser = 'U_ATOMIC_MAPPED'
  const unmappedUser = 'U_ATOMIC_UNMAPPED'
  const from = '2098-06-01T00:00:00Z'
  const to = '2098-06-02T23:59:59Z'
  const map = { [mappedUser]: memberId }

  async function cleanup() {
    await supabase.schema('bronze').from('slack_messages').delete().like('message_ts', 'ATOMIC_%')
    await supabase.schema('bronze').from('slack_reactions').delete().like('message_ts', 'ATOMIC_%')
    await supabase.from('member_activities').delete().eq('source', 'slack').gte('occurred_at', from).lte('occurred_at', to)
  }

  function message(ts: string, overrides: Record<string, unknown> = {}) {
    return {
      message_ts: ts,
      channel_id: 'C_ATOMIC',
      channel_name: 'atomic-channel',
      channel_type: 'public_channel',
      user_id: mappedUser,
      text: 'hello',
      message_type: 'message',
      thread_ts: null,
      occurred_at: '2098-06-01T10:00:00Z',
      deleted_at: null,
      files: null,
      imported_at: new Date().toISOString(),
      raw_payload: {},
      ...overrides,
    }
  }

  async function rebuild(userMap: Record<string, string> = map) {
    return supabase.rpc('reprocess_slack_activities_atomic', {
      from_date: from,
      to_date: to,
      user_member_map: userMap,
    })
  }

  async function activities() {
    const { data, error } = await supabase
      .from('member_activities')
      .select('*')
      .eq('source', 'slack')
      .gte('occurred_at', from)
      .lte('occurred_at', to)
      .order('related_id')
    expect(error).toBeNull()
    return data ?? []
  }

  beforeAll(async () => {
    await cleanup()
    await supabase.from('members').delete().eq('id', memberId)
    const { error } = await supabase.from('members').insert({
      id: memberId,
      email: 'slack-atomic@example.com',
      name: 'Slack Atomic Member',
      joined_at: '2022-01-01',
      status: 'active',
    })
    expect(error).toBeNull()
  })

  beforeEach(cleanup)

  afterAll(async () => {
    await cleanup()
    await supabase.from('members').delete().eq('id', memberId)
  })

  it('maps messages and reactions the way the route used to', async () => {
    const { error: msgError } = await supabase.schema('bronze').from('slack_messages').insert([
      message('ATOMIC_1'), // top-level: 1 + 2
      message('ATOMIC_2', { thread_ts: 'ATOMIC_1', text: 'x'.repeat(600) }), // reply 1 + 1, long +1
      message('ATOMIC_3', { thread_ts: 'ATOMIC_3', files: [{ id: 'F1' }] }), // own thread starter 1, files +2
      message('ATOMIC_4', { user_id: unmappedUser }), // non-member: skipped
      message('ATOMIC_5', { deleted_at: '2098-06-01T12:00:00Z' }), // soft-deleted: skipped
      message('ATOMIC_6', { occurred_at: '2098-07-01T10:00:00Z' }), // outside window: skipped
    ])
    expect(msgError).toBeNull()
    const reaction = {
      message_ts: 'ATOMIC_1',
      channel_id: 'C_ATOMIC',
      channel_name: 'atomic-channel',
      user_id: mappedUser,
      occurred_at: '2098-06-01T10:05:00Z',
      imported_at: new Date().toISOString(),
      raw_payload: {},
    }
    const { error: reactionError } = await supabase.schema('bronze').from('slack_reactions').insert([
      { ...reaction, reaction: 'tada', deleted_at: null },
      { ...reaction, reaction: 'eyes', deleted_at: '2098-06-01T11:00:00Z' }, // removed: skipped
    ])
    expect(reactionError).toBeNull()

    const { data, error } = await rebuild()
    expect(error).toBeNull()
    expect(data).toEqual({ messages: 3, reactions: 1 })

    const rows = await activities()
    expect(rows).toHaveLength(4)
    const byRelated = Object.fromEntries(rows.map((r) => [r.related_id, r]))

    // ATOMIC_1 has a message and a reaction under the same related_id
    const message1 = rows.find((r) => r.related_id === 'C_ATOMIC:ATOMIC_1' && r.activity_type === 'slack_message')!
    expect(message1).toMatchObject({
      member_id: memberId,
      activity_category: 'communication',
      title: 'Posted in #atomic-channel',
      description: 'hello',
      engagement_value: 3,
    })
    expect(message1.data).toMatchObject({
      channel_id: 'C_ATOMIC',
      channel_name: 'atomic-channel',
      channel_type: 'public_channel',
      message_ts: 'ATOMIC_1',
      thread_ts: null,
      is_thread_reply: false,
      has_files: false,
    })

    const reply = byRelated['C_ATOMIC:ATOMIC_2']
    expect(reply.activity_type).toBe('slack_thread_reply')
    expect(reply.engagement_value).toBe(3)
    expect(reply.description).toHaveLength(200)
    expect(reply.data.is_thread_reply).toBe(true)

    const withFiles = byRelated['C_ATOMIC:ATOMIC_3']
    expect(withFiles.activity_type).toBe('slack_message')
    expect(withFiles.engagement_value).toBe(3)
    expect(withFiles.data.has_files).toBe(true)

    const react = rows.find((r) => r.activity_type === 'slack_reaction')!
    expect(react).toMatchObject({
      title: 'Reacted :tada:',
      description: null,
      engagement_value: 1,
      member_id: memberId,
    })
    expect(react.data).toMatchObject({ channel_name: 'atomic-channel', reaction: 'tada', message_ts: 'ATOMIC_1' })
  })

  it('replaces the window on each run without duplicating or keeping orphans', async () => {
    await supabase.schema('bronze').from('slack_messages').insert([message('ATOMIC_1'), message('ATOMIC_2')])
    expect((await rebuild()).error).toBeNull()
    expect(await activities()).toHaveLength(2)

    expect((await rebuild()).error).toBeNull()
    expect(await activities()).toHaveLength(2)

    await supabase
      .schema('bronze').from('slack_messages')
      .update({ deleted_at: '2098-06-01T12:00:00Z' })
      .eq('message_ts', 'ATOMIC_2')
    expect((await rebuild()).error).toBeNull()
    const rows = await activities()
    expect(rows).toHaveLength(1)
    expect(rows[0].related_id).toBe('C_ATOMIC:ATOMIC_1')
  })

  it('leaves existing activities alone when Bronze has nothing in the window', async () => {
    const { error: seedError } = await supabase.from('member_activities').insert({
      member_id: memberId,
      activity_type: 'slack_message',
      activity_category: 'communication',
      title: 'Posted in #old',
      related_id: 'C_ATOMIC:ATOMIC_OLD',
      occurred_at: '2098-06-01T09:00:00Z',
      source: 'slack',
    })
    expect(seedError).toBeNull()

    const { data, error } = await rebuild()
    expect(error).toBeNull()
    expect(data).toEqual({ messages: 0, reactions: 0 })
    expect(await activities()).toHaveLength(1)
  })

  it('clears an emptied window when the caller has already checked its whole range', async () => {
    // /api/process/slack checks once that its range has Slack data, then
    // rebuilds a week at a time with skip_empty_check.
    await supabase.schema('bronze').from('slack_messages').insert([message('ATOMIC_1')])
    expect((await rebuild()).error).toBeNull()
    expect(await activities()).toHaveLength(1)
    await supabase.schema('bronze').from('slack_messages').update({ deleted_at: '2098-06-01T12:00:00Z' }).eq('message_ts', 'ATOMIC_1')

    // By default an empty window is left alone...
    expect((await rebuild()).data).toEqual({ messages: 0, reactions: 0 })
    expect(await activities()).toHaveLength(1)

    // ...and with skip_empty_check its orphaned activity is removed.
    const { data, error } = await supabase.rpc('reprocess_slack_activities_atomic', {
      from_date: from,
      to_date: to,
      user_member_map: map,
      skip_empty_check: true,
    })
    expect(error).toBeNull()
    expect(data).toEqual({ messages: 0, reactions: 0 })
    expect(await activities()).toHaveLength(0)
  })

  it('rolls the DELETE back when the INSERT fails', async () => {
    const { error: seedError } = await supabase.from('member_activities').insert({
      member_id: memberId,
      activity_type: 'slack_message',
      activity_category: 'communication',
      title: 'Posted in #old',
      related_id: 'C_ATOMIC:ATOMIC_OLD',
      occurred_at: '2098-06-01T09:00:00Z',
      source: 'slack',
    })
    expect(seedError).toBeNull()
    await supabase.schema('bronze').from('slack_messages').insert(message('ATOMIC_1'))

    // A member id that doesn't exist violates the member_activities FK on INSERT
    const { error } = await rebuild({ [mappedUser]: missingMemberId })
    expect(error).not.toBeNull()

    const rows = await activities()
    expect(rows).toHaveLength(1)
    expect(rows[0].related_id).toBe('C_ATOMIC:ATOMIC_OLD')
  })
})
