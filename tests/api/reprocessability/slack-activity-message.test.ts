import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'

/**
 * slack_activity_project_message rebuilds the Slack member_activities of ONE message from Bronze, for the
 * webhook (the windowed reprocess_slack_activities_atomic is too slow to run per event and its overlapping
 * runs queued behind each other into the statement timeout). The point of these tests: it must produce exactly
 * the rows the windowed rebuild would, whatever the message is, and stay correct when it runs twice or at once.
 */
describe('slack_activity_project_message', () => {
  const supabase = getTestSupabaseAdminClient()
  const memberId = '00000000-0000-0000-0000-0000000000b1'
  const mapped = 'U_PMSG_MAPPED'
  const unmapped = 'U_PMSG_UNMAPPED'
  const from = '2098-08-01T00:00:00Z'
  const to = '2098-08-02T23:59:59Z'
  const channels = ['C_PMSG_PUBLIC', 'C_PMSG_RESTRICTED', 'C_PMSG_DM', 'C_PMSG_GROUP']

  async function cleanup() {
    await supabase.from('member_activities').delete().eq('source', 'slack').like('related_id', 'C_PMSG_%')
    await supabase.schema('bronze').from('slack_messages').delete().in('channel_id', channels)
    await supabase.schema('bronze').from('slack_reactions').delete().in('channel_id', channels)
    await supabase.from('restricted_slack_channels').delete().eq('channel_id', 'C_PMSG_RESTRICTED')
    await supabase.from('chat_slack_authors').delete().eq('slack_user_id', mapped)
  }

  const message = (channel: string, ts: string, overrides: Record<string, unknown> = {}) => ({
    message_ts: ts,
    channel_id: channel,
    channel_name: 'pmsg-channel',
    channel_type: 'public_channel',
    user_id: mapped,
    text: 'hello there',
    message_type: 'message',
    thread_ts: null,
    occurred_at: '2098-08-01T10:00:00Z',
    deleted_at: null,
    files: null,
    imported_at: new Date().toISOString(),
    raw_payload: {},
    ...overrides,
  })

  const reaction = (channel: string, ts: string, name: string, overrides: Record<string, unknown> = {}) => ({
    message_ts: ts,
    channel_id: channel,
    channel_name: 'pmsg-channel',
    user_id: mapped,
    reaction: name,
    occurred_at: '2098-08-01T10:05:00Z',
    deleted_at: null,
    imported_at: new Date().toISOString(),
    raw_payload: {},
    ...overrides,
  })

  /** Every kind of message and reaction the rules treat differently. */
  async function seed() {
    const { error: e1 } = await supabase.schema('bronze').from('slack_messages').insert([
      message('C_PMSG_PUBLIC', 'PMSG_1'),
      message('C_PMSG_PUBLIC', 'PMSG_2', { thread_ts: 'PMSG_1', text: 'x'.repeat(600) }),
      message('C_PMSG_PUBLIC', 'PMSG_3', { thread_ts: 'PMSG_3', files: [{ id: 'F1' }] }),
      message('C_PMSG_PUBLIC', 'PMSG_4', { user_id: unmapped }),
      message('C_PMSG_PUBLIC', 'PMSG_5', { deleted_at: '2098-08-01T12:00:00Z' }),
      message('C_PMSG_PUBLIC', 'PMSG_6', { message_type: 'channel_name', text: 'renamed the channel' }),
      message('C_PMSG_RESTRICTED', 'PMSG_7', { channel_name: 'pmsg-secret', text: 'private words' }),
      message('C_PMSG_DM', 'PMSG_8', { channel_type: 'im', text: 'a direct message' }),
      message('C_PMSG_GROUP', 'PMSG_9', { channel_type: 'mpim', text: 'a group message' }),
    ])
    expect(e1).toBeNull()
    const { error: e2 } = await supabase.schema('bronze').from('slack_reactions').insert([
      reaction('C_PMSG_PUBLIC', 'PMSG_1', 'tada'),
      reaction('C_PMSG_PUBLIC', 'PMSG_1', 'eyes', { deleted_at: '2098-08-01T11:00:00Z' }),
      reaction('C_PMSG_PUBLIC', 'PMSG_1', 'wave', { user_id: unmapped }),
      reaction('C_PMSG_PUBLIC', 'PMSG_2', 'tada'),
    ])
    expect(e2).toBeNull()
  }

  const keys = [...new Set(['PMSG_1', 'PMSG_2', 'PMSG_3', 'PMSG_4', 'PMSG_5', 'PMSG_6', 'PMSG_7', 'PMSG_8', 'PMSG_9'])]
  const channelOf = (ts: string) => (ts === 'PMSG_7' ? 'C_PMSG_RESTRICTED' : ts === 'PMSG_8' ? 'C_PMSG_DM' : ts === 'PMSG_9' ? 'C_PMSG_GROUP' : 'C_PMSG_PUBLIC')

  async function rows() {
    const { data, error } = await supabase.from('member_activities').select('*').eq('source', 'slack').like('related_id', 'C_PMSG_%')
    expect(error).toBeNull()
    // Everything about a row except the ids and times the database makes up.
    return (data ?? [])
      .map(({ id: _id, created_at: _created, updated_at: _updated, ...rest }) => rest)
      .sort((a, b) => `${a.related_id}|${a.activity_type}|${a.title}`.localeCompare(`${b.related_id}|${b.activity_type}|${b.title}`))
  }

  const project = (channel: string, ts: string) => supabase.rpc('slack_activity_project_message', { p_channel_id: channel, p_message_ts: ts })

  beforeAll(async () => {
    await cleanup()
    await supabase.from('members').delete().eq('id', memberId)
    const { error } = await supabase.from('members').insert({
      id: memberId,
      email: 'slack-activity-message@example.com',
      name: 'Slack Activity Message',
      joined_at: '2022-01-01',
      status: 'active',
    })
    expect(error).toBeNull()
  })

  beforeEach(async () => {
    await cleanup()
    await supabase.from('chat_slack_authors').insert({ slack_user_id: mapped, member_id: memberId })
    await supabase.from('restricted_slack_channels').insert({ channel_id: 'C_PMSG_RESTRICTED', name: 'pmsg-secret' })
  })

  afterAll(async () => {
    await cleanup()
    await supabase.from('members').delete().eq('id', memberId)
  })

  it('produces exactly the rows the windowed rebuild produces, message by message', async () => {
    await seed()
    const rebuilt = await supabase.rpc('reprocess_slack_activities_atomic', { from_date: from, to_date: to, user_member_map: { [mapped]: memberId } })
    expect(rebuilt.error).toBeNull()
    const windowed = await rows()
    expect(windowed.length).toBeGreaterThan(5)

    await supabase.from('member_activities').delete().eq('source', 'slack').like('related_id', 'C_PMSG_%')
    expect(await rows()).toHaveLength(0)
    for (const ts of keys) {
      const { error } = await project(channelOf(ts), ts)
      expect(error).toBeNull()
    }
    expect(await rows()).toEqual(windowed)
  })

  it('applies the privacy rules: no text for DMs, group DMs or restricted channels, nothing for notices, deleted or unmatched', async () => {
    await seed()
    for (const ts of keys) await project(channelOf(ts), ts)
    const byRelated = Object.fromEntries((await rows()).filter((r) => r.activity_type !== 'slack_reaction').map((r) => [r.related_id, r]))

    expect(byRelated['C_PMSG_PUBLIC:PMSG_1']).toMatchObject({ description: 'hello there', title: 'Posted in #pmsg-channel', engagement_value: 3 })
    expect(byRelated['C_PMSG_RESTRICTED:PMSG_7']).toMatchObject({ description: null })
    expect(byRelated['C_PMSG_DM:PMSG_8']).toMatchObject({ description: null, title: 'Sent a direct message' })
    expect(byRelated['C_PMSG_GROUP:PMSG_9']).toMatchObject({ description: null, title: 'Sent a group message' })
    for (const skipped of ['PMSG_4', 'PMSG_5', 'PMSG_6']) expect(byRelated[`C_PMSG_PUBLIC:${skipped}`]).toBeUndefined()
  })

  it("replaces the same message's rows when run again, and follows what Bronze says now", async () => {
    await seed()
    await project('C_PMSG_PUBLIC', 'PMSG_1')
    await project('C_PMSG_PUBLIC', 'PMSG_1')
    const once = (await rows()).filter((r) => r.related_id === 'C_PMSG_PUBLIC:PMSG_1')
    expect(once.map((r) => r.activity_type).sort()).toEqual(['slack_message', 'slack_reaction'])

    // The message is edited, one reaction is taken back and another added.
    await supabase.schema('bronze').from('slack_messages').update({ text: 'edited text' }).eq('channel_id', 'C_PMSG_PUBLIC').eq('message_ts', 'PMSG_1')
    await supabase.schema('bronze').from('slack_reactions').update({ deleted_at: '2098-08-01T13:00:00Z' }).eq('message_ts', 'PMSG_1').eq('reaction', 'tada')
    await supabase.schema('bronze').from('slack_reactions').insert(reaction('C_PMSG_PUBLIC', 'PMSG_1', 'clap'))
    await project('C_PMSG_PUBLIC', 'PMSG_1')
    const after = (await rows()).filter((r) => r.related_id === 'C_PMSG_PUBLIC:PMSG_1')
    expect(after.find((r) => r.activity_type === 'slack_message')?.description).toBe('edited text')
    expect(after.filter((r) => r.activity_type === 'slack_reaction').map((r) => r.title)).toEqual(['Reacted :clap:'])

    // Deleted in Slack: nothing left for it.
    await supabase.schema('bronze').from('slack_messages').update({ deleted_at: '2098-08-01T14:00:00Z' }).eq('message_ts', 'PMSG_1')
    await supabase.schema('bronze').from('slack_reactions').update({ deleted_at: '2098-08-01T14:00:00Z' }).eq('message_ts', 'PMSG_1')
    await project('C_PMSG_PUBLIC', 'PMSG_1')
    expect((await rows()).filter((r) => r.related_id === 'C_PMSG_PUBLIC:PMSG_1')).toHaveLength(0)
  })

  it("touches only that message's rows", async () => {
    await seed()
    await project('C_PMSG_PUBLIC', 'PMSG_1')
    await project('C_PMSG_PUBLIC', 'PMSG_2')
    const before = await rows()
    await project('C_PMSG_PUBLIC', 'PMSG_1')
    expect((await rows()).filter((r) => r.related_id === 'C_PMSG_PUBLIC:PMSG_2')).toEqual(before.filter((r) => r.related_id === 'C_PMSG_PUBLIC:PMSG_2'))
  })

  it('writes a message only once when many events about it arrive at the same instant', async () => {
    await seed()
    const results = await Promise.all(Array.from({ length: 12 }, () => project('C_PMSG_PUBLIC', 'PMSG_1')))
    expect(results.every((r) => r.error === null)).toBe(true)
    expect((await rows()).filter((r) => r.related_id === 'C_PMSG_PUBLIC:PMSG_1')).toHaveLength(2) // the message and its one live reaction from a known member
  })

  it('takes the author of a message posted from the Hub from the chat, not from the Slack user (the bot)', async () => {
    const hubMember = '00000000-0000-0000-0000-0000000000b2'
    await supabase.from('members').delete().eq('id', hubMember)
    await supabase.from('members').insert({ id: hubMember, email: 'slack-activity-hub@example.com', name: 'Hub Author', joined_at: '2022-01-01', status: 'active' })
    try {
      await supabase.schema('bronze').from('slack_messages').insert(message('C_PMSG_PUBLIC', 'PMSG_HUB', { user_id: 'B_THE_BOT', raw_payload: { bot_id: 'B_THE_BOT' } }))
      const { data: chan } = await supabase.from('chat_channels').insert({ kind: 'channel', visibility: 'public', slack_channel_id: 'C_PMSG_PUBLIC', name: 'pmsg-channel' }).select('id').single()
      try {
        await supabase.from('chat_messages').insert({ channel_id: chan!.id, author_member_id: hubMember, origin: 'app', slack_ts: 'PMSG_HUB', created_at: '2098-08-01T10:00:00Z', slack_sync_status: 'sent' })
        await project('C_PMSG_PUBLIC', 'PMSG_HUB')
        expect((await rows()).find((r) => r.related_id === 'C_PMSG_PUBLIC:PMSG_HUB')?.member_id).toBe(hubMember)
      } finally {
        await supabase.from('chat_channels').delete().eq('id', chan!.id)
      }
    } finally {
      await supabase.from('member_activities').delete().eq('member_id', hubMember)
      await supabase.from('members').delete().eq('id', hubMember)
    }
  })

  it('does nothing for a Slack user the chat has no member for yet (the next rebuild covers them) and for an unknown message', async () => {
    await seed()
    const { data, error } = await project('C_PMSG_PUBLIC', 'PMSG_4')
    expect(error).toBeNull()
    expect(data).toEqual({ messages: 0, reactions: 0 })
    expect((await project('C_PMSG_PUBLIC', 'NOPE')).data).toEqual({ messages: 0, reactions: 0 })
    expect(await rows()).toHaveLength(0)
  })

  it('can be called only with the service role', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    const { error } = await anon.rpc('slack_activity_project_message', { p_channel_id: 'C_PMSG_PUBLIC', p_message_ts: 'PMSG_1' })
    expect(error).not.toBeNull()
  })
})
