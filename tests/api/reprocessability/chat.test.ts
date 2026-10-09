import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'

/**
 * /api/process/chat projects Bronze Slack data into the chat mirror.
 *
 * Core principle: the chat_* tables must be fully regenerable from Bronze and re-runnable.
 * Reprocessing must keep ids stable (so /chat/<id> URLs survive), carry Bronze changes and
 * soft deletes over, and never create duplicates.
 */
describe('Chat mirror reprocessability', () => {
  const supabase = getTestSupabaseAdminClient()
  const testMemberId = '00000000-0000-0000-0000-0000000000c1'
  const testSlackUserId = 'U_TEST_CHAT'
  const testEmail = 'chat-reprocess@example.com'
  const channelId = 'C_TEST_CHAT'
  const day = '2099-05-01'

  async function cleanup() {
    await supabase.from('chat_channels').delete().eq('slack_channel_id', channelId) // cascades messages, contents, reactions
    await supabase.schema('bronze').from('slack_reactions').delete().eq('channel_id', channelId)
    await supabase.schema('bronze').from('slack_messages').delete().eq('channel_id', channelId)
    await supabase.schema('bronze').from('slack_channels').delete().eq('channel_id', channelId)
    await supabase.schema('bronze').from('slack_users').delete().eq('user_id', testSlackUserId)
    await supabase.from('members').delete().eq('id', testMemberId)
  }

  async function process() {
    const response = await fetch(`${getTestApiBaseUrl()}/api/process/chat`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromDate: `${day}T00:00:00Z`, toDate: `${day}T23:59:59Z` }),
    })
    if (!response.ok) throw new Error(`API call failed: ${response.status} - ${await response.text()}`)
    return response.json()
  }

  const messages = async () => {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, slack_ts, author_member_id, deleted_at, chat_message_contents(body)')
      .eq('channel_id', (await channel()).id)
      .order('slack_ts')
    expect(error).toBeNull()
    return data ?? []
  }
  const channel = async () => {
    const { data } = await supabase.from('chat_channels').select('id, name, kind').eq('slack_channel_id', channelId).single()
    return data!
  }

  const bronzeMessage = (ts: string, text: string, extra: Record<string, unknown> = {}) => ({
    message_ts: ts,
    channel_id: channelId,
    channel_name: 'chat-test',
    channel_type: 'public_channel',
    user_id: testSlackUserId,
    user_email: testEmail,
    user_name: 'Chat Tester',
    text,
    message_type: 'message',
    thread_ts: null,
    reply_count: 0,
    occurred_at: `${day}T10:00:00Z`,
    deleted_at: null,
    files: null,
    imported_at: new Date().toISOString(),
    raw_payload: {},
    ...extra,
  })

  beforeAll(async () => {
    await cleanup()
    const { error } = await supabase.from('members').insert({
      id: testMemberId, email: testEmail, name: 'Chat Tester', joined_at: '2022-01-01', status: 'active',
    })
    if (error) throw error
    await supabase.schema('bronze').from('slack_users').insert({
      user_id: testSlackUserId, email: testEmail, name: 'chat_tester', display_name: 'Chat Tester',
      real_name: 'Chat Tester', is_bot: false, is_deleted: false, imported_at: new Date().toISOString(), raw_payload: {},
    })
    await supabase.schema('bronze').from('slack_channels').insert({
      channel_id: channelId, name: 'chat-test', is_private: false, is_archived: false, is_mpim: false,
      imported_at: new Date().toISOString(), raw_payload: {},
    })
  })

  afterAll(cleanup)

  it('creates the channel, messages, contents and authors from Bronze on first process', async () => {
    const { error } = await supabase.schema('bronze').from('slack_messages').insert([
      bronzeMessage(`${day.replace(/-/g, '')}.001`, 'Hello world'),
      bronzeMessage(`${day.replace(/-/g, '')}.002`, 'Second post'),
    ])
    expect(error).toBeNull()

    const result = await process()
    expect(result.success).toBe(true)

    expect((await channel()).kind).toBe('channel')
    const rows = await messages()
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.author_member_id)).toEqual([testMemberId, testMemberId])
    expect((rows[0].chat_message_contents as unknown as { body: string }).body).toBe('Hello world')
  })

  it('keeps ids stable and creates no duplicates when reprocessing', async () => {
    const before = await messages()
    await process()
    await process()
    const after = await messages()

    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id))
  })

  it('carries changed Bronze text over to the content', async () => {
    await supabase.schema('bronze').from('slack_messages').update({ text: 'Hello again' })
      .eq('channel_id', channelId).eq('message_ts', `${day.replace(/-/g, '')}.001`)
    await process()

    const rows = await messages()
    expect((rows[0].chat_message_contents as unknown as { body: string }).body).toBe('Hello again')
  })

  it('soft-deletes a message deleted in Bronze (the row stays) and un-deletes it when it returns', async () => {
    const ts = `${day.replace(/-/g, '')}.002`
    const [{ id }] = (await messages()).filter((r) => r.slack_ts === ts)

    await supabase.schema('bronze').from('slack_messages').update({ deleted_at: `${day}T11:00:00Z` })
      .eq('channel_id', channelId).eq('message_ts', ts)
    await process()
    let row = (await messages()).find((r) => r.slack_ts === ts)!
    expect(row.id).toBe(id)
    expect(row.deleted_at).not.toBeNull()

    await supabase.schema('bronze').from('slack_messages').update({ deleted_at: null })
      .eq('channel_id', channelId).eq('message_ts', ts)
    await process()
    row = (await messages()).find((r) => r.slack_ts === ts)!
    expect(row.id).toBe(id)
    expect(row.deleted_at).toBeNull()
  })

  it('never deletes a chat message that has left Bronze (the Hub keeps Slack comms for good)', async () => {
    const ts = `${day.replace(/-/g, '')}.001`
    await supabase.schema('bronze').from('slack_messages').delete().eq('channel_id', channelId).eq('message_ts', ts)
    await process()

    expect((await messages()).some((r) => r.slack_ts === ts)).toBe(true)
  })
})
