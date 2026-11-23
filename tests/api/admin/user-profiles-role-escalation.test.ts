import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestSupabaseClient } from '../../helpers/supabase'
import { giveRoles } from '../../helpers/user-roles'

/**
 * A person's roles are `user_roles` rows, which every admin check trusts, and members can UPDATE their own profile row (to set
 * timezone_preference). These tests use real signed-in sessions to prove a member can't promote themselves (not through the roles table
 * and not through the profile: email and id stay guarded, and there is no role column to write), while members can still change their
 * timezone and admins can still change roles. See supabase/migrations/20260925000000_block_self_role_escalation.sql and
 * 20271110000000_drop_user_profiles_role.sql.
 */
describe('user roles and the privileged profile columns', () => {
  const admin = getTestSupabaseAdminClient()
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const password = 'test-password-12345!'
  const authUserIds: string[] = []

  let memberId: string
  let otherMemberId: string
  let memberClient: ReturnType<typeof getTestSupabaseClient>
  let adminClient: ReturnType<typeof getTestSupabaseClient>

  async function createUser(label: string, role: 'member' | 'admin') {
    const email = `role-esc-${label}-${suffix}@example.com`
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error || !data.user) throw new Error(`Failed to create ${label}: ${error?.message}`)
    authUserIds.push(data.user.id)
    await giveRoles(admin, data.user.id, role)
    const client = getTestSupabaseClient()
    const { error: signInError } = await client.auth.signInWithPassword({ email, password })
    if (signInError) throw new Error(`Failed to sign in as ${label}: ${signInError.message}`)
    return { id: data.user.id, client }
  }

  async function rolesOf(id: string) {
    const { data } = await admin.from('user_roles').select('role').eq('user_id', id)
    return (data ?? []).map((r) => r.role).sort()
  }

  async function profileOf(id: string) {
    const { data } = await admin.from('user_profiles').select('email, timezone_preference').eq('id', id).single()
    return data
  }

  beforeAll(async () => {
    const member = await createUser('member', 'member')
    memberId = member.id
    memberClient = member.client
    otherMemberId = (await createUser('other', 'member')).id
    adminClient = (await createUser('admin', 'admin')).client
  })

  afterAll(async () => {
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id)
  })

  it('has no role column on the profile to promote through', async () => {
    const { error } = await memberClient.from('user_profiles').update({ role: 'admin' } as never).eq('id', memberId)
    expect(error).not.toBeNull()
    expect(await rolesOf(memberId)).toEqual([])
  })

  it('rejects a member giving themselves a role', async () => {
    const { error } = await memberClient.from('user_roles').insert({ user_id: memberId, role: 'admin' })
    expect(error?.code).toBe('42501')
    expect(await rolesOf(memberId)).toEqual([])
  })

  it('rejects a member calling set_user_roles for themselves', async () => {
    const { error } = await memberClient.rpc('set_user_roles', { p_user: memberId, p_roles: ['admin'] })
    expect(error?.code).toBe('42501')
    expect(await rolesOf(memberId)).toEqual([])
  })

  it('rejects a member changing their own email on the profile', async () => {
    const before = await profileOf(memberId)
    const { error } = await memberClient
      .from('user_profiles')
      .update({ email: `hijack-${suffix}@example.com` })
      .eq('id', memberId)
    expect(error?.code).toBe('42501')
    expect((await profileOf(memberId))?.email).toBe(before?.email)
  })

  it("can't touch another member's profile or roles at all", async () => {
    const { data } = await memberClient
      .from('user_profiles')
      .update({ timezone_preference: 'Europe/London' })
      .eq('id', otherMemberId)
      .select('id')
    expect(data ?? []).toEqual([])
    const { error } = await memberClient.from('user_roles').insert({ user_id: otherMemberId, role: 'admin' })
    expect(error?.code).toBe('42501')
    expect(await rolesOf(otherMemberId)).toEqual([])
  })

  it('still lets a member change their own timezone preference', async () => {
    const { error } = await memberClient
      .from('user_profiles')
      .update({ timezone_preference: 'America/Chicago' })
      .eq('id', memberId)
    expect(error).toBeNull()
    expect((await profileOf(memberId))?.timezone_preference).toBe('America/Chicago')
  })

  it("still lets an admin session change another user's roles", async () => {
    const { error } = await adminClient.rpc('set_user_roles', { p_user: otherMemberId, p_roles: ['community_manager', 'conversion_specialist'] })
    expect(error).toBeNull()
    expect(await rolesOf(otherMemberId)).toEqual(['community_manager', 'conversion_specialist'])
    const { error: revertError } = await adminClient.rpc('set_user_roles', { p_user: otherMemberId, p_roles: [] })
    expect(revertError).toBeNull()
    expect(await rolesOf(otherMemberId)).toEqual([])
  })

  it('still lets the service role change roles (server-side jobs, invites)', async () => {
    await giveRoles(admin, memberId, 'admin')
    expect(await rolesOf(memberId)).toEqual(['admin'])
    await giveRoles(admin, memberId, 'member')
    expect(await rolesOf(memberId)).toEqual([])
  })
})
