import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestSupabaseClient } from '../../helpers/supabase'

/**
 * Calls the event-attendee RPCs directly over PostgREST (not through the requireAdmin-gated
 * API routes), since that's the path the Supabase Security Advisor flagged: they used to be
 * SECURITY DEFINER + executable by anon, so anyone with the public anon key could award
 * badges. See 20260926000300_harden_security_advisor_findings.sql.
 */
describe('event attendee RPCs: direct-call authorization', () => {
  const admin = getTestSupabaseAdminClient()
  const ts = Date.now()
  const password = 'test-password-12345!'

  let memberAuthUserId: string
  let adminAuthUserId: string
  let memberId: string
  let eventId: string
  let badgeTypeId: string
  let memberClient: ReturnType<typeof getTestSupabaseClient>
  let adminClient: ReturnType<typeof getTestSupabaseClient>

  async function signedInClient(email: string, role: 'member' | 'admin') {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error || !data.user) throw new Error(`Failed to create test user: ${error?.message}`)
    await admin.from('user_profiles').update({ role }).eq('id', data.user.id)
    const client = getTestSupabaseClient()
    const { error: signInError } = await client.auth.signInWithPassword({ email, password })
    if (signInError) throw new Error(`Failed to sign in: ${signInError.message}`)
    return { client, userId: data.user.id }
  }

  const awardsFor = async () =>
    (await admin.from('member_badges').select('id').eq('member_id', memberId).eq('badge_type_id', badgeTypeId)).data ?? []

  beforeAll(async () => {
    ;({ client: memberClient, userId: memberAuthUserId } = await signedInClient(`rpc-sec-member-${ts}@example.com`, 'member'))
    ;({ client: adminClient, userId: adminAuthUserId } = await signedInClient(`rpc-sec-admin-${ts}@example.com`, 'admin'))

    const { data: member } = await admin
      .from('members')
      .insert({ name: 'RPC Sec Member', email: `rpc-sec-member-${ts}@example.com`, joined_at: '2023-01-01', status: 'active' })
      .select('id')
      .single()
    memberId = member!.id

    const { data: event } = await admin
      .from('events')
      .insert({ slug: `rpc-sec-${ts}`, title: `RPC Sec ${ts}`, event_type: 'other', starts_at: '2026-06-01', ends_at: '2026-06-01' })
      .select('id')
      .single()
    eventId = event!.id

    const { data: badge } = await admin
      .from('badge_types')
      .insert({ key: `rpc_sec_${ts}`, name: `RPC Sec ${ts}`, category: 'retreat', event_id: eventId })
      .select('id')
      .single()
    badgeTypeId = badge!.id
  })

  afterAll(async () => {
    if (badgeTypeId) await admin.from('badge_types').delete().eq('id', badgeTypeId)
    if (eventId) await admin.from('events').delete().eq('id', eventId)
    if (memberId) await admin.from('members').delete().eq('id', memberId)
    await admin.auth.admin.deleteUser(memberAuthUserId).catch(() => {})
    await admin.auth.admin.deleteUser(adminAuthUserId).catch(() => {})
  })

  it('anon cannot call add_event_attendee / remove_event_attendee / sync_event_badge_awards', async () => {
    const anon = getTestSupabaseClient()
    const add = await anon.rpc('add_event_attendee', { p_event_id: eventId, p_member_id: memberId, p_admin_id: null })
    const remove = await anon.rpc('remove_event_attendee', { p_event_id: eventId, p_member_id: memberId })
    const sync = await anon.rpc('sync_event_badge_awards', { p_event_id: eventId })
    expect(add.error).not.toBeNull()
    expect(remove.error).not.toBeNull()
    expect(sync.error).not.toBeNull()
    expect(await awardsFor()).toEqual([])
  })

  it('a non-admin member cannot grant themselves a linked badge via add_event_attendee', async () => {
    const { error } = await memberClient.rpc('add_event_attendee', {
      p_event_id: eventId,
      p_member_id: memberId,
      p_admin_id: memberAuthUserId,
    })
    expect(error).not.toBeNull()
    expect(await awardsFor()).toEqual([])
    // The whole call rolled back, so no orphaned attendee row either.
    const { data: attendees } = await admin.from('event_attendees').select('id').eq('event_id', eventId)
    expect(attendees).toEqual([])
  })

  it('an admin session can still add and remove attendees, granting and revoking the badge', async () => {
    const add = await adminClient.rpc('add_event_attendee', {
      p_event_id: eventId,
      p_member_id: memberId,
      p_admin_id: adminAuthUserId,
    })
    expect(add.error).toBeNull()
    expect(await awardsFor()).toHaveLength(1)

    const remove = await adminClient.rpc('remove_event_attendee', { p_event_id: eventId, p_member_id: memberId })
    expect(remove.error).toBeNull()
    expect(await awardsFor()).toEqual([])
  })

  it('create_user_profile (auth.users trigger) is not callable over the API', async () => {
    const { error } = await memberClient.rpc('create_user_profile')
    expect(error).not.toBeNull()
  })
})
