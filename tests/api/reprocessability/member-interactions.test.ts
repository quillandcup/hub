import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
import { apiFetch } from '../../helpers/api-fetch'

/**
 * /api/process/member-interactions builds member_interactions (who talked with whom) from the chat
 * tables.
 *
 * Core principle: Silver must be fully regenerable from its sources by DELETE + INSERT. Reprocessing
 * must create the rows, drop the ones whose source is gone, carry changes over, never leave orphans
 * or duplicates, and only touch the date range it was asked to.
 */
describe('Member interactions reprocessability', () => {
  const supabase = getTestSupabaseAdminClient()
  const fern = '00000000-0000-0000-0000-0000000000d1'
  const gale = '00000000-0000-0000-0000-0000000000d2'
  const hazel = '00000000-0000-0000-0000-0000000000d3'
  const slackChannelId = 'C_TEST_INTERACTIONS'
  const day = '2099-06-01'
  const nextWeek = '2099-06-20'

  async function cleanup() {
    await supabase.from('chat_channels').delete().eq('slack_channel_id', slackChannelId) // cascades messages, contents, interactions
    await supabase.from('members').delete().in('id', [fern, gale, hazel]) // cascades interactions
  }

  async function process(from = day, to = day) {
    const response = await apiFetch(`${getTestApiBaseUrl()}/api/process/member-interactions`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromDate: `${from}T00:00:00Z`, toDate: `${to}T23:59:59Z` }),
    })
    if (!response.ok) throw new Error(`API call failed: ${response.status} - ${await response.text()}`)
    return response.json()
  }

  let channelId: string
  async function message(slackTs: string, author: string, extra: Record<string, unknown> = {}) {
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({ channel_id: channelId, author_member_id: author, slack_ts: slackTs, created_at: `${day}T10:00:00Z`, origin: 'slack', ...extra })
      .select('id')
      .single()
    expect(error).toBeNull()
    return data!.id as string
  }

  const interactions = async () => {
    const { data, error } = await supabase
      .from('member_interactions')
      .select('member_a, member_b, kind, visibility, message_id, occurred_at')
      .or(`member_a.in.(${fern},${gale},${hazel}),member_b.in.(${fern},${gale},${hazel})`)
      .order('occurred_at')
    expect(error).toBeNull()
    return data ?? []
  }

  beforeAll(cleanup)
  afterAll(cleanup)
  beforeEach(async () => {
    await cleanup()
    await supabase.from('members').insert([
      { id: fern, name: 'Interactions Fern', email: 'interactions-fern@example.com', joined_at: '2022-01-01T00:00:00Z', status: 'active' },
      { id: gale, name: 'Interactions Gale', email: 'interactions-gale@example.com', joined_at: '2022-01-01T00:00:00Z', status: 'active' },
      { id: hazel, name: 'Interactions Hazel', email: 'interactions-hazel@example.com', joined_at: '2022-01-01T00:00:00Z', status: 'active' },
    ])
    const { data } = await supabase
      .from('chat_channels')
      .insert({ kind: 'channel', visibility: 'public', name: 'interactions-test', slack_channel_id: slackChannelId })
      .select('id')
      .single()
    channelId = data!.id
  })

  it('refuses a request without admin credentials', async () => {
    const response = await apiFetch(`${getTestApiBaseUrl()}/api/process/member-interactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromDate: `${day}T00:00:00Z`, toDate: `${day}T23:59:59Z` }),
    })
    expect(response.status).toBe(401)
  })

  it('needs a date range', async () => {
    const response = await apiFetch(`${getTestApiBaseUrl()}/api/process/member-interactions`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(400)
  })

  it('creates interactions from the chat on the first run', async () => {
    const root = await message('9.1', fern)
    await message('9.2', gale, { thread_root_id: root })

    const result = await process()

    expect(result.success).toBe(true)
    expect(result.processed).toMatchObject({ thread_replies: 1, windows: 1 })
    const rows = await interactions()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ member_a: gale, member_b: fern, kind: 'thread_reply', visibility: 'public' })
  })

  it('removes interactions whose source is gone when reprocessing (a deleted message)', async () => {
    const root = await message('9.1', fern)
    const reply = await message('9.2', gale, { thread_root_id: root })
    await process()
    expect(await interactions()).toHaveLength(1)

    await supabase.from('chat_messages').update({ deleted_at: `${day}T11:00:00Z` }).eq('id', reply)
    await process()

    expect(await interactions()).toHaveLength(0)
  })

  it('carries a changed source over (a new author, a message made private)', async () => {
    const root = await message('9.1', fern)
    const reply = await message('9.2', gale, { thread_root_id: root })
    await process()

    await supabase.from('chat_messages').update({ author_member_id: hazel }).eq('id', reply)
    await supabase.from('chat_channels').update({ visibility: 'private' }).eq('id', channelId)
    await process()

    const rows = await interactions()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ member_a: hazel, member_b: fern, visibility: 'private' })
  })

  it('is idempotent: reprocessing twice leaves the same rows, no duplicates', async () => {
    const root = await message('9.1', fern)
    await message('9.2', gale, { thread_root_id: root })
    await supabase.from('chat_reactions').insert({ message_id: root, member_id: hazel, emoji: 'tada', created_at: `${day}T12:00:00Z` })

    await process()
    const first = await interactions()
    await process()
    const second = await interactions()

    expect(first).toHaveLength(2)
    expect(second).toEqual(first)
  })

  it('replaces the date range (DELETE + INSERT, not UPSERT): a stray row in range is removed, one outside is kept', async () => {
    const root = await message('9.1', fern)
    const inRange = { member_a: hazel, member_b: gale, kind: 'mention', channel_id: channelId, message_id: root, visibility: 'public' }
    await supabase.from('member_interactions').insert([
      { ...inRange, occurred_at: `${day}T09:00:00Z` }, // no source behind it
      { ...inRange, occurred_at: `${nextWeek}T09:00:00Z` }, // outside the range being rebuilt
    ])

    await process()

    const rows = await interactions()
    expect(rows.map((r) => r.occurred_at)).toEqual([`${nextWeek}T09:00:00+00:00`])
  })

  it('rebuilds a range of several weeks one week at a time', async () => {
    const root = await message('9.1', fern)
    await message('9.2', gale, { thread_root_id: root })
    const later = await message('9.3', fern, { created_at: `${nextWeek}T10:00:00Z` })
    await message('9.4', hazel, { thread_root_id: later, created_at: `${nextWeek}T10:05:00Z` })

    const result = await process(day, nextWeek)

    expect(result.processed.windows).toBeGreaterThanOrEqual(3)
    expect(result.processed.thread_replies).toBe(2)
    expect(await interactions()).toHaveLength(2)
  })
})
