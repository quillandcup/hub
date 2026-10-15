import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestSupabaseClient } from '../../helpers/supabase'

/**
 * RLS write boundary for the tables tightened in
 * 20260926000600_tighten_permissive_write_policies.sql. Hits PostgREST directly with real
 * member/admin sessions (the API routes' requireAdmin isn't in play here).
 *
 * Postgres checks RLS WITH CHECK before NOT NULL / other constraints, so an empty INSERT is a
 * clean probe: a denied role gets 42501, a permitted one gets past RLS (and then usually a
 * constraint error, which is fine). A denied UPDATE/DELETE doesn't error -- it just matches no
 * rows -- so those are asserted by re-reading with the service-role client.
 */

type Client = ReturnType<typeof getTestSupabaseClient>

const ADMIN_ONLY_INSERT: Array<[schema: 'public' | 'bronze', table: string]> = [
  ...[
    'calendar_events', 'kajabi_contacts', 'kajabi_customers', 'kajabi_members', 'kajabi_offers',
    'kajabi_purchases',
    'stripe_customers', 'stripe_products', 'stripe_subscriptions', 'subscription_history',
    'zoom_attendees', 'zoom_meetings',
  ].map((t) => ['bronze', t] as ['bronze', string]),
  ...[
    'admin_work_queue_completions', 'ambiguous_zoom_names', 'dismissed_duplicate_groups',
    'feature_flag_segments', 'feature_flags', 'ignored_slack_users', 'ignored_zoom_names',
    'member_engagement', 'member_hiatus_history', 'member_join_date_overrides', 'member_metrics',
    'member_program_enrollments', 'member_status_overrides', 'outreach_leads', 'outreach_touches',
    'prickle_attendance', 'prickle_popularity', 'prickle_types', 'prickles', 'program_cohorts',
    'programs', 'segment_members', 'segments', 'staff', 'unmatched_calendar_events', 'members',
  ].map((t) => ['public', t] as ['public', string]),
]

describe('tightened write policies (RLS)', () => {
  const service = getTestSupabaseAdminClient()
  const ts = Date.now()
  const password = 'test-password-12345!'
  const memberEmail = `wp-rls-member-${ts}@example.com`

  const authUserIds: string[] = []
  const memberIds: string[] = []
  let memberClient: Client
  let adminClient: Client
  let ownMemberId: string
  let otherMemberId: string
  let typeId: string

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

  async function newMember(label: string, email = `wp-rls-${label}-${ts}@example.com`) {
    const { data, error } = await service
      .from('members')
      .insert({ name: `WP RLS ${label}`, email, joined_at: '2023-01-01', status: 'active' })
      .select('id')
      .single()
    if (error) throw error
    memberIds.push(data.id)
    return data.id as string
  }

  const from = (client: Client, schema: 'public' | 'bronze', table: string) =>
    schema === 'bronze' ? client.schema('bronze').from(table) : client.from(table)

  beforeAll(async () => {
    memberClient = await signedInClient(memberEmail, 'member')
    adminClient = await signedInClient(`wp-rls-admin-${ts}@example.com`, 'admin')
    ownMemberId = await newMember('own', memberEmail)
    otherMemberId = await newMember('other')
    const { data: type, error } = await service
      .from('prickle_types')
      .insert({ name: `WP RLS Type ${ts}`, normalized_name: `wp-rls-type-${ts}` })
      .select('id')
      .single()
    if (error) throw error
    typeId = type.id
    // The member "hosts" nothing in prickles; RLS only checks host_id ownership.
  })

  afterAll(async () => {
    // Scoped cleanup: only rows this suite created (FK cascades take activities/vibes/matches).
    await service.from('prickle_host_vibes').delete().eq('type_id', typeId)
    await service.from('wheel_of_wonder_matches').delete().in('spinner_member_id', memberIds)
    await service.from('member_activities').delete().in('member_id', memberIds)
    if (typeId) await service.from('prickle_types').delete().eq('id', typeId)
    if (memberIds.length) await service.from('members').delete().in('id', memberIds)
    for (const id of authUserIds) await service.auth.admin.deleteUser(id).catch(() => {})
  })

  describe('admin-only tables', () => {
    it.each(ADMIN_ONLY_INSERT)('a signed-in member cannot insert into %s.%s', async (schema, table) => {
      const { error } = await from(memberClient, schema, table).insert({})
      expect(error?.code).toBe('42501')
    })

    it.each(ADMIN_ONLY_INSERT)('anon cannot insert into %s.%s', async (schema, table) => {
      const { error } = await from(getTestSupabaseClient(), schema, table).insert({})
      expect(error).not.toBeNull()
    })

    it.each(ADMIN_ONLY_INSERT)('an admin session gets past RLS on %s.%s', async (schema, table) => {
      const { data, error } = await from(adminClient, schema, table).insert({}).select()
      expect(error?.code).not.toBe('42501')
      // A few tables accept an all-defaults row; remove exactly what was created.
      for (const row of (data ?? []) as Array<{ id?: string }>) {
        if (row.id) await from(service, schema, table).delete().eq('id', row.id)
      }
    })

    // raw_payload on these isn't readable by API roles (20261009000000_slack_content_privacy.sql), so
    // the probes skip .select(): RETURNING * would be denied for that reason, not for the write.
    describe.each(['slack_channels', 'slack_reactions', 'slack_users'])('bronze.%s', (table) => {
      it('a signed-in member cannot insert', async () => {
        const { error } = await memberClient.schema('bronze').from(table).insert({})
        expect(error?.code).toBe('42501')
      })

      it('an admin session gets past RLS (and stops at NOT NULL)', async () => {
        const { error } = await adminClient.schema('bronze').from(table).insert({})
        expect(error?.code).toBe('23502')
      })
    })

    it('not even an admin session can insert into bronze.slack_messages (service role only)', async () => {
      const { error } = await adminClient.schema('bronze').from('slack_messages').insert({})
      expect(error?.code).toBe('42501')
    })

    it('a signed-in member cannot update or delete prickle_types rows', async () => {
      await memberClient.from('prickle_types').update({ name: 'hijacked' }).eq('id', typeId)
      await memberClient.from('prickle_types').delete().eq('id', typeId)
      const { data } = await service.from('prickle_types').select('name').eq('id', typeId).single()
      expect(data?.name).toBe(`WP RLS Type ${ts}`)
    })

    it('an admin session can update prickle_types', async () => {
      const { data, error } = await adminClient
        .from('prickle_types')
        .update({ name: `WP RLS Type ${ts}` })
        .eq('id', typeId)
        .select('id')
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
    })

    it('a signed-in member can no longer read outreach leads/touches or dismissed duplicate groups', async () => {
      for (const table of ['outreach_leads', 'outreach_touches', 'dismissed_duplicate_groups']) {
        const { data, error } = await memberClient.from(table).select('*').limit(1)
        expect(error).toBeNull()
        expect(data).toEqual([])
      }
    })

    it('a signed-in member can still read bronze slack tables (SELECT preserved)', async () => {
      const { error } = await memberClient.schema('bronze').from('slack_users').select('user_id').limit(1)
      expect(error).toBeNull()
    })
  })

  describe('members (own row, self-service columns only)', () => {
    it('a member can update their own name and birthday', async () => {
      const { data, error } = await memberClient
        .from('members')
        .update({ name: `WP RLS own renamed`, birthday_month: 5, birthday_day: 17 })
        .eq('id', ownMemberId)
        .select('id')
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
    })

    it("a member cannot change their own status, email or staff_role", async () => {
      for (const patch of [{ status: 'cancelled' }, { email: `evil-${ts}@example.com` }, { staff_role: 'admin' }]) {
        const { error } = await memberClient.from('members').update(patch).eq('id', ownMemberId)
        expect(error?.code).toBe('42501')
      }
      const { data } = await service.from('members').select('status, email, staff_role').eq('id', ownMemberId).single()
      expect(data).toEqual({ status: 'active', email: memberEmail, staff_role: null })
    })

    it("a member cannot update or delete another member's row", async () => {
      await memberClient.from('members').update({ name: 'hijacked' }).eq('id', otherMemberId)
      await memberClient.from('members').delete().eq('id', otherMemberId)
      const { data } = await service.from('members').select('name').eq('id', otherMemberId).single()
      expect(data?.name).toBe('WP RLS other')
    })

    it("an admin session can update any member's protected columns", async () => {
      const { data, error } = await adminClient
        .from('members')
        .update({ status: 'active', name: 'WP RLS other' })
        .eq('id', otherMemberId)
        .select('id')
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
    })
  })

  describe('member_activities (own rows)', () => {
    const activity = (memberId: string) => ({
      member_id: memberId,
      activity_type: 'writing_progress_logged',
      activity_category: 'writing',
      title: 'WP RLS test',
      occurred_at: new Date().toISOString(),
      source: 'writing_progress',
    })

    it('a member can insert and delete their own activity', async () => {
      const { data, error } = await memberClient.from('member_activities').insert(activity(ownMemberId)).select('id').single()
      expect(error).toBeNull()
      const del = await memberClient.from('member_activities').delete().eq('id', data!.id).select('id')
      expect(del.error).toBeNull()
      expect(del.data).toHaveLength(1)
    })

    it("a member cannot insert or delete another member's activity", async () => {
      const ins = await memberClient.from('member_activities').insert(activity(otherMemberId))
      expect(ins.error?.code).toBe('42501')

      const { data: row } = await service.from('member_activities').insert(activity(otherMemberId)).select('id').single()
      await memberClient.from('member_activities').delete().eq('id', row!.id)
      const { data: still } = await service.from('member_activities').select('id').eq('id', row!.id)
      expect(still).toHaveLength(1)
    })

    it("an admin session can insert another member's activity", async () => {
      const { error } = await adminClient.from('member_activities').insert(activity(otherMemberId))
      expect(error).toBeNull()
    })
  })

  describe('prickle_host_vibes (own host_id)', () => {
    it('a host can upsert their own vibe', async () => {
      const row = { type_id: typeId, host_id: ownMemberId, vibe: 'focused' }
      expect((await memberClient.from('prickle_host_vibes').upsert(row, { onConflict: 'type_id,host_id' })).error).toBeNull()
      expect(
        (await memberClient.from('prickle_host_vibes').upsert({ ...row, vibe: 'chatty' }, { onConflict: 'type_id,host_id' })).error
      ).toBeNull()
    })

    it("a member cannot write another host's vibe", async () => {
      const { error } = await memberClient
        .from('prickle_host_vibes')
        .insert({ type_id: typeId, host_id: otherMemberId, vibe: 'focused' })
      expect(error?.code).toBe('42501')
    })

    it("an admin session can write any host's vibe", async () => {
      const { error } = await adminClient
        .from('prickle_host_vibes')
        .upsert({ type_id: typeId, host_id: otherMemberId, vibe: 'balanced' }, { onConflict: 'type_id,host_id' })
      expect(error).toBeNull()
    })
  })

  describe('wheel_of_wonder_matches (own spins)', () => {
    const match = (spinner: string, matched: string) => ({
      spinner_member_id: spinner,
      matched_member_id: matched,
      slack_channel_id: `C-WP-${ts}-${spinner.slice(0, 6)}`,
      status: 'proposed',
    })

    it('a member can record their own spin', async () => {
      expect((await memberClient.from('wheel_of_wonder_matches').insert(match(ownMemberId, otherMemberId))).error).toBeNull()
    })

    it('a member cannot record a spin as someone else', async () => {
      const { error } = await memberClient.from('wheel_of_wonder_matches').insert(match(otherMemberId, ownMemberId))
      expect(error?.code).toBe('42501')
    })
  })
})
