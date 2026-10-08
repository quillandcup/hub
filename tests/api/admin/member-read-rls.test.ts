import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestSupabaseClient } from '../../helpers/supabase'

/**
 * Read-side RLS from 20260926000700_restrict_member_readable_data.sql, exercised over
 * PostgREST with real member/admin sessions:
 *   - members: own row (all columns) or admin; other members only via member_directory
 *   - member_directory is trigger-synced from members and embeddable via computed relationships
 *   - bronze.* and admin note/history tables: admin-only
 *   - member_activities: own rows or admin
 * A denied SELECT under RLS returns zero rows rather than an error.
 */

type Client = ReturnType<typeof getTestSupabaseClient>

const BRONZE_TABLES = [
  'calendar_events', 'kajabi_contacts', 'kajabi_customers', 'kajabi_members', 'kajabi_offers',
  'kajabi_purchases',
  'stripe_customers', 'stripe_products', 'stripe_subscriptions', 'subscription_history',
  'zoom_attendees', 'zoom_meetings',
]

// Slack metadata tables: admin-only like the rest, minus raw_payload, which no API role can read
// (20261009000000_slack_content_privacy.sql). A column grant makes select('*') an error.
const SLACK_METADATA_TABLES = ['slack_channels', 'slack_reactions', 'slack_users']

describe('member-readable data (RLS)', () => {
  const service = getTestSupabaseAdminClient()
  const ts = Date.now()
  const password = 'test-password-12345!'
  const memberEmail = `mr-rls-member-${ts}@example.com`
  const otherEmail = `mr-rls-other-${ts}@example.com`

  const authUserIds: string[] = []
  const memberIds: string[] = []
  let memberClient: Client
  let adminClient: Client
  let ownId: string
  let otherId: string
  let typeId: string
  let prickleId: string
  let slackUserId: string

  async function signedInClient(email: string, role: 'member' | 'admin') {
    const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true })
    if (error || !data.user) throw new Error(`Failed to create test user: ${error?.message}`)
    authUserIds.push(data.user.id)
    await service.from('user_profiles').update({ role }).eq('id', data.user.id)
    const client = getTestSupabaseClient()
    const { error: signInError } = await client.auth.signInWithPassword({ email, password })
    if (signInError) throw new Error(`Failed to sign in: ${signInError.message}`)
    return client
  }

  async function newMember(label: string, email: string) {
    const { data, error } = await service
      .from('members')
      .insert({
        name: `MR RLS ${label}`,
        email,
        joined_at: '2023-01-01',
        status: 'active',
        bio: `${label} bio`,
        stripe_customer_id: `cus_mr_${label}_${ts}`,
        raw_payload: { secret: `${label}-payload` },
      })
      .select('id')
      .single()
    if (error) throw error
    memberIds.push(data.id)
    return data.id as string
  }

  beforeAll(async () => {
    memberClient = await signedInClient(memberEmail, 'member')
    adminClient = await signedInClient(`mr-rls-admin-${ts}@example.com`, 'admin')
    ownId = await newMember('own', memberEmail)
    otherId = await newMember('other', otherEmail)

    const { data: type, error: typeError } = await service
      .from('prickle_types')
      .insert({ name: `MR RLS Type ${ts}`, normalized_name: `mr-rls-type-${ts}` })
      .select('id')
      .single()
    if (typeError) throw typeError
    typeId = type.id

    const { data: prickle, error: prickleError } = await service
      .from('prickles')
      .insert({
        type_id: typeId,
        host: otherId,
        start_time: '2026-01-05T15:00:00Z',
        end_time: '2026-01-05T16:00:00Z',
        source: 'calendar',
      })
      .select('id')
      .single()
    if (prickleError) throw prickleError
    prickleId = prickle.id

    const attendance = (memberId: string) => ({
      member_id: memberId,
      prickle_id: prickleId,
      join_time: '2026-01-05T15:00:00Z',
      leave_time: '2026-01-05T16:00:00Z',
      confidence_score: 'high',
    })
    const { error: attError } = await service.from('prickle_attendance').insert([attendance(ownId), attendance(otherId)])
    if (attError) throw attError

    const activity = (memberId: string) => ({
      member_id: memberId,
      activity_type: 'writing_progress_logged',
      activity_category: 'writing',
      title: 'MR RLS',
      occurred_at: new Date().toISOString(),
      source: 'writing_progress',
    })
    const { error: actError } = await service.from('member_activities').insert([activity(ownId), activity(otherId)])
    if (actError) throw actError

    const { error: hiatusError } = await service
      .from('member_hiatus_history')
      .insert([{ member_id: ownId, start_date: '2024-01-01' }, { member_id: otherId, start_date: '2024-01-01' }])
    if (hiatusError) throw hiatusError

    const { error: bookError } = await service.from('member_books').insert({
      member_id: otherId,
      title: `MR RLS Book ${ts}`,
      cover_url: 'https://example.com/c.jpg',
      purchase_url: 'https://example.com/b',
      published_date: '2025-01-01',
    })
    if (bookError) throw bookError

    slackUserId = `UMRRLS${ts}`
    const { error: slackError } = await service
      .schema('bronze')
      .from('slack_users')
      .insert({ user_id: slackUserId, email: otherEmail, real_name: 'MR RLS other', raw_payload: {} })
    if (slackError) throw slackError
  })

  afterAll(async () => {
    // Scoped cleanup only (member deletes cascade attendance/activities/hiatus/books/directory).
    if (slackUserId) await service.schema('bronze').from('slack_users').delete().eq('user_id', slackUserId)
    if (prickleId) await service.from('prickles').delete().eq('id', prickleId)
    if (typeId) await service.from('prickle_types').delete().eq('id', typeId)
    if (memberIds.length) await service.from('members').delete().in('id', memberIds)
    for (const id of authUserIds) await service.auth.admin.deleteUser(id).catch(() => {})
  })

  describe('members', () => {
    it('a member reads every column of their own row', async () => {
      const { data, error } = await memberClient
        .from('members')
        .select('id, email, raw_payload, stripe_customer_id, kajabi_tags, status')
        .eq('id', ownId)
        .single()
      expect(error).toBeNull()
      expect(data?.email).toBe(memberEmail)
      expect(data?.stripe_customer_id).toBe(`cus_mr_own_${ts}`)
    })

    it("a member cannot read another member's row from members", async () => {
      const { data, error } = await memberClient.from('members').select('id, email').eq('id', otherId)
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('a member only ever sees their own row when listing members', async () => {
      const { data } = await memberClient.from('members').select('id').in('id', [ownId, otherId])
      expect(data).toEqual([{ id: ownId }])
    })

    it("an admin reads another member's private columns", async () => {
      const { data, error } = await adminClient
        .from('members')
        .select('email, raw_payload, stripe_customer_id')
        .eq('id', otherId)
        .single()
      expect(error).toBeNull()
      expect(data?.email).toBe(otherEmail)
      expect(data?.raw_payload).toEqual({ secret: 'other-payload' })
    })

    it('anon reads nothing', async () => {
      const { data } = await getTestSupabaseClient().from('members').select('id').in('id', [ownId, otherId])
      expect(data ?? []).toEqual([])
    })
  })

  describe('member_directory', () => {
    it("a member reads another member's public profile fields", async () => {
      const { data, error } = await memberClient
        .from('member_directory')
        .select('id, name, display_name, photo_url, bio, joined_at, first_joined_at, total_active_months')
        .eq('id', otherId)
        .single()
      expect(error).toBeNull()
      expect(data?.name).toBe('MR RLS other')
      expect(data?.bio).toBe('other bio')
    })

    it('exposes no private columns', async () => {
      for (const column of ['email', 'raw_payload', 'stripe_customer_id', 'kajabi_tags', 'status', 'user_id', 'birthday_month']) {
        const { error } = await memberClient.from('member_directory').select(column).eq('id', otherId)
        expect(error, column).not.toBeNull()
      }
    })

    it('stays in sync with members (service-role update, member self-service rename)', async () => {
      await service.from('members').update({ display_name: `Other DN ${ts}` }).eq('id', otherId)
      const { data: other } = await memberClient.from('member_directory').select('display_name').eq('id', otherId).single()
      expect(other?.display_name).toBe(`Other DN ${ts}`)

      const { error } = await memberClient.from('members').update({ name: 'MR RLS own renamed' }).eq('id', ownId)
      expect(error).toBeNull()
      const { data: own } = await adminClient.from('member_directory').select('name').eq('id', ownId).single()
      expect(own?.name).toBe('MR RLS own renamed')
    })

    it('members cannot write it', async () => {
      const { error } = await memberClient.from('member_directory').insert({ id: ownId, name: 'x', joined_at: '2023-01-01' })
      expect(error).not.toBeNull()
      await memberClient.from('member_directory').update({ name: 'hijacked' }).eq('id', otherId)
      const { data } = await service.from('member_directory').select('name').eq('id', otherId).single()
      expect(data?.name).toBe('MR RLS other')
    })

    it('anon reads nothing', async () => {
      const { data } = await getTestSupabaseClient().from('member_directory').select('id').eq('id', otherId)
      expect(data ?? []).toEqual([])
    })
  })

  describe('computed relationships (embeds of public member fields)', () => {
    it('prickles -> prickle_host', async () => {
      const { data, error } = await memberClient
        .from('prickles')
        .select('id, host:prickle_host(id, name)')
        .eq('id', prickleId)
        .single()
      expect(error).toBeNull()
      expect(data?.host).toEqual({ id: otherId, name: 'MR RLS other' })
    })

    it('prickle_attendance -> attendance_member (including !inner)', async () => {
      const { data, error } = await memberClient
        .from('prickle_attendance')
        .select('member_id, members:attendance_member!inner(id, name)')
        .eq('prickle_id', prickleId)
        .eq('member_id', otherId)
      expect(error).toBeNull()
      expect(data).toEqual([{ member_id: otherId, members: { id: otherId, name: 'MR RLS other' } }])
    })

    it('member_books -> book_member', async () => {
      const { data, error } = await memberClient
        .from('member_books')
        .select('title, members:book_member(name)')
        .eq('member_id', otherId)
      expect(error).toBeNull()
      expect(data).toEqual([{ title: `MR RLS Book ${ts}`, members: { name: 'MR RLS other' } }])
    })

    it('embedding members directly no longer leaks other members', async () => {
      const { data } = await memberClient
        .from('prickles')
        .select('id, host:members(id, email)')
        .eq('id', prickleId)
        .single()
      expect(data?.host).toBeNull()
    })
  })

  describe('bronze (admin-only reads)', () => {
    it.each(BRONZE_TABLES)('a signed-in member reads nothing from bronze.%s', async (table) => {
      const { data, error } = await memberClient.schema('bronze').from(table).select('*').limit(1)
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it.each(SLACK_METADATA_TABLES)('a signed-in member reads nothing from bronze.%s', async (table) => {
      const { data, error } = await memberClient.schema('bronze').from(table).select('imported_at').limit(1)
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it.each(SLACK_METADATA_TABLES)('not even an admin reads raw_payload from bronze.%s', async (table) => {
      const { error } = await adminClient.schema('bronze').from(table).select('raw_payload').limit(1)
      expect(error?.code).toBe('42501')
    })

    it('message content is closed to members and admins alike', async () => {
      for (const client of [memberClient, adminClient]) {
        const { error } = await client.schema('bronze').from('slack_messages').select('text').limit(1)
        expect(error?.code).toBe('42501')
      }
    })

    it('a member reads nothing from the message metadata view', async () => {
      const { data, error } = await memberClient.schema('bronze').from('slack_messages_meta').select('message_ts').limit(1)
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('an admin still reads bronze', async () => {
      const { data, error } = await adminClient.schema('bronze').from('slack_users').select('user_id').eq('user_id', slackUserId)
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
    })
  })

  describe('admin notes / history', () => {
    it.each([
      'member_status_overrides', 'member_join_date_overrides', 'member_hiatus_history',
      'admin_work_queue_completions', 'ambiguous_zoom_names',
    ])('a signed-in member reads nothing from %s', async (table) => {
      const { data, error } = await memberClient.from(table).select('*').limit(1)
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('an admin reads member_hiatus_history', async () => {
      const { data } = await adminClient.from('member_hiatus_history').select('member_id').in('member_id', [ownId, otherId])
      expect(data).toHaveLength(2)
    })
  })

  describe('member_activities', () => {
    it('a member sees only their own activities', async () => {
      const { data } = await memberClient.from('member_activities').select('member_id').in('member_id', [ownId, otherId])
      expect((data ?? []).map((r) => r.member_id)).toEqual([ownId])
    })

    it('an admin sees everyone', async () => {
      const { data } = await adminClient.from('member_activities').select('member_id').in('member_id', [ownId, otherId])
      expect(new Set((data ?? []).map((r) => r.member_id))).toEqual(new Set([ownId, otherId]))
    })
  })
})
