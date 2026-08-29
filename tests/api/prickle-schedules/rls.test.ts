import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestSupabaseClient } from '../../helpers/supabase'
import { getMonthStart, getNextMonthStart } from '@/lib/prickle-schedules'

/**
 * Exercises the prickle_schedules RLS policy directly (not through the Next.js
 * API layer, which always runs as admin/service-role) -- this is the actual
 * authorization boundary for this table, per the design decision to make RLS
 * (not just app-level checks) the real gate for member self-service writes.
 */
describe('prickle_schedules RLS', () => {
  const admin = getTestSupabaseAdminClient()
  const ts = Date.now()
  const now = new Date()
  const currentMonth = getMonthStart(now).toISOString().slice(0, 10)
  const nextMonth = getNextMonthStart(now).toISOString().slice(0, 10)
  const password = 'test-password-12345!'

  let hostAuthUserId: string
  let adminAuthUserId: string
  let hostMemberId: string
  let otherMemberId: string
  let typeId: string
  let hostClient: ReturnType<typeof getTestSupabaseClient>
  let adminClient: ReturnType<typeof getTestSupabaseClient>

  beforeAll(async () => {
    const hostEmail = `rls-host-${ts}@example.com`
    const { data: hostAuth, error } = await admin.auth.admin.createUser({
      email: hostEmail,
      password,
      email_confirm: true,
    })
    if (error || !hostAuth.user) throw new Error(`Failed to create host test user: ${error?.message}`)
    hostAuthUserId = hostAuth.user.id

    // New users default to role='member' already, but set it explicitly so
    // this test doesn't depend on that default staying what it is today.
    await admin.from('user_profiles').update({ role: 'member' }).eq('id', hostAuthUserId)

    // Second user, promoted to role='admin' (the on_auth_user_created trigger
    // defaults new users to 'member' as of 20260514000001_change_role_default_to_member.sql),
    // to exercise the is_admin() bypass branch of the RLS policy via a real
    // cookie-style session -- not the service-role client, which bypasses RLS
    // entirely regardless of policy content and so wouldn't actually prove
    // the is_admin() branch works.
    const adminEmail = `rls-admin-${ts}@example.com`
    const { data: adminAuth, error: adminError } = await admin.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
    })
    if (adminError || !adminAuth.user) throw new Error(`Failed to create admin test user: ${adminError?.message}`)
    adminAuthUserId = adminAuth.user.id
    await admin.from('user_profiles').update({ role: 'admin' }).eq('id', adminAuthUserId)

    adminClient = getTestSupabaseClient()
    const { error: adminSignInError } = await adminClient.auth.signInWithPassword({ email: adminEmail, password })
    if (adminSignInError) throw new Error(`Failed to sign in as admin: ${adminSignInError.message}`)

    const { data: hostMember } = await admin
      .from('members')
      .insert({ name: 'RLS Host', email: hostEmail, joined_at: '2023-01-01', status: 'active' })
      .select('id')
      .single()
    hostMemberId = hostMember!.id

    const { data: otherMember } = await admin
      .from('members')
      .insert({ name: 'RLS Other Host', email: `rls-other-${ts}@example.com`, joined_at: '2023-01-01', status: 'active' })
      .select('id')
      .single()
    otherMemberId = otherMember!.id

    const { data: type } = await admin
      .from('prickle_types')
      .insert({ name: `RLS Test Type ${ts}`, normalized_name: `rls-test-type-${ts}`, requires_host: true })
      .select('id')
      .single()
    typeId = type!.id

    hostClient = getTestSupabaseClient()
    const { error: signInError } = await hostClient.auth.signInWithPassword({ email: hostEmail, password })
    if (signInError) throw new Error(`Failed to sign in as host: ${signInError.message}`)
  })

  afterAll(async () => {
    await admin.from('prickle_schedules').delete().in('host_id', [hostMemberId, otherMemberId])
    await admin.from('members').delete().in('id', [hostMemberId, otherMemberId])
    await admin.from('prickle_types').delete().eq('id', typeId)
    await admin.auth.admin.deleteUser(hostAuthUserId).catch(() => {})
    await admin.auth.admin.deleteUser(adminAuthUserId).catch(() => {})
  })

  it("lets a real admin session write another host's row in a locked month (sudo path)", async () => {
    const { data, error } = await adminClient
      .from('prickle_schedules')
      .insert({
        host_id: otherMemberId,
        type_id: typeId,
        month: currentMonth,
        recurrence_type: 'weekly',
        day_of_week: 1,
        start_time_local: '19:00',
        status: 'confirmed',
      })
      .select('id')
      .single()

    expect(error).toBeNull()
    expect(data).toBeTruthy()

    await admin.from('prickle_schedules').delete().eq('id', data!.id)
  })

  it('lets a host insert their own row for an unlocked (future) month', async () => {
    const { data, error } = await hostClient
      .from('prickle_schedules')
      .insert({
        host_id: hostMemberId,
        type_id: typeId,
        month: nextMonth,
        recurrence_type: 'weekly',
        day_of_week: 2,
        start_time_local: '19:00',
      })
      .select('id')
      .single()

    expect(error).toBeNull()
    expect(data).toBeTruthy()

    await admin.from('prickle_schedules').delete().eq('id', data!.id)
  })

  it("blocks a host from inserting a row for a different host's id", async () => {
    const { data, error } = await hostClient
      .from('prickle_schedules')
      .insert({
        host_id: otherMemberId,
        type_id: typeId,
        month: nextMonth,
        recurrence_type: 'weekly',
        day_of_week: 3,
        start_time_local: '19:00',
      })
      .select('id')
      .single()

    expect(data).toBeNull()
    expect(error).toBeTruthy()
  })

  it('blocks a host from inserting into a locked (current) month', async () => {
    const { data, error } = await hostClient
      .from('prickle_schedules')
      .insert({
        host_id: hostMemberId,
        type_id: typeId,
        month: currentMonth,
        recurrence_type: 'weekly',
        day_of_week: 4,
        start_time_local: '19:00',
      })
      .select('id')
      .single()

    expect(data).toBeNull()
    expect(error).toBeTruthy()
  })

  it("lets a host update and soft-delete their own row in an unlocked month", async () => {
    const { data: created } = await admin
      .from('prickle_schedules')
      .insert({
        host_id: hostMemberId,
        type_id: typeId,
        month: nextMonth,
        recurrence_type: 'weekly',
        day_of_week: 5,
        start_time_local: '19:00',
      })
      .select('id')
      .single()

    const { data: updated, error: updateError } = await hostClient
      .from('prickle_schedules')
      .update({ notes: 'updated by host' })
      .eq('id', created!.id)
      .select('notes')
      .single()
    expect(updateError).toBeNull()
    expect(updated!.notes).toBe('updated by host')

    const { error: deleteError } = await hostClient
      .from('prickle_schedules')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', created!.id)
    expect(deleteError).toBeNull()

    await admin.from('prickle_schedules').delete().eq('id', created!.id)
  })

  it('blocks a host from updating a row in a locked (current) month', async () => {
    const { data: created } = await admin
      .from('prickle_schedules')
      .insert({
        host_id: hostMemberId,
        type_id: typeId,
        month: currentMonth,
        recurrence_type: 'weekly',
        day_of_week: 6,
        start_time_local: '19:00',
      })
      .select('id')
      .single()

    const { data: updated } = await hostClient
      .from('prickle_schedules')
      .update({ notes: 'should not apply' })
      .eq('id', created!.id)
      .select('notes')

    // RLS silently filters out rows the policy doesn't permit rather than
    // erroring on UPDATE -- zero rows come back instead of an update landing.
    expect(updated).toEqual([])

    const { data: unchanged } = await admin.from('prickle_schedules').select('notes').eq('id', created!.id).single()
    expect(unchanged!.notes).toBeNull()

    await admin.from('prickle_schedules').delete().eq('id', created!.id)
  })

  it('lets the service-role (admin) client write regardless of owner or lock', async () => {
    const { data, error } = await admin
      .from('prickle_schedules')
      .insert({
        host_id: otherMemberId,
        type_id: typeId,
        month: currentMonth,
        recurrence_type: 'weekly',
        day_of_week: 0,
        start_time_local: '19:00',
        status: 'confirmed',
      })
      .select('id')
      .single()

    expect(error).toBeNull()
    expect(data).toBeTruthy()

    await admin.from('prickle_schedules').delete().eq('id', data!.id)
  })
})
