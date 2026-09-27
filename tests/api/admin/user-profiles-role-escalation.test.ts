import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestSupabaseClient } from '../../helpers/supabase'

/**
 * user_profiles.role is what every admin check trusts, and members can UPDATE their
 * own row (to set timezone_preference). These tests use real signed-in sessions to
 * prove a member can't promote themselves (or touch role/email/id at all), while
 * members can still change their timezone and admins can still change roles.
 * See supabase/migrations/20260925000000_block_self_role_escalation.sql.
 */
describe('user_profiles privileged columns', () => {
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
    const { error: roleError } = await admin.from('user_profiles').update({ role }).eq('id', data.user.id)
    if (roleError) throw new Error(`Failed to set ${label} role: ${roleError.message}`)
    const client = getTestSupabaseClient()
    const { error: signInError } = await client.auth.signInWithPassword({ email, password })
    if (signInError) throw new Error(`Failed to sign in as ${label}: ${signInError.message}`)
    return { id: data.user.id, client }
  }

  async function roleOf(id: string) {
    const { data } = await admin.from('user_profiles').select('role, email').eq('id', id).single()
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

  it('rejects a member promoting themselves to admin', async () => {
    const { error } = await memberClient.from('user_profiles').update({ role: 'admin' }).eq('id', memberId)
    expect(error?.code).toBe('42501')
    expect((await roleOf(memberId))?.role).toBe('member')
  })

  it('rejects a member changing their own email on the profile', async () => {
    const before = await roleOf(memberId)
    const { error } = await memberClient
      .from('user_profiles')
      .update({ email: `hijack-${suffix}@example.com` })
      .eq('id', memberId)
    expect(error?.code).toBe('42501')
    expect((await roleOf(memberId))?.email).toBe(before?.email)
  })

  it('rejects a role change even when bundled with an allowed column', async () => {
    const { error } = await memberClient
      .from('user_profiles')
      .update({ timezone_preference: 'Europe/London', role: 'admin' })
      .eq('id', memberId)
    expect(error?.code).toBe('42501')
    expect((await roleOf(memberId))?.role).toBe('member')
  })

  it("can't touch another member's row at all", async () => {
    const { data } = await memberClient
      .from('user_profiles')
      .update({ role: 'admin' })
      .eq('id', otherMemberId)
      .select('id')
    expect(data ?? []).toEqual([])
    expect((await roleOf(otherMemberId))?.role).toBe('member')
  })

  it('still lets a member change their own timezone preference', async () => {
    const { error } = await memberClient
      .from('user_profiles')
      .update({ timezone_preference: 'America/Chicago' })
      .eq('id', memberId)
    expect(error).toBeNull()
    const { data } = await admin.from('user_profiles').select('timezone_preference').eq('id', memberId).single()
    expect(data?.timezone_preference).toBe('America/Chicago')
  })

  it("still lets an admin session change another user's role", async () => {
    const { error } = await adminClient.from('user_profiles').update({ role: 'admin' }).eq('id', otherMemberId)
    expect(error).toBeNull()
    expect((await roleOf(otherMemberId))?.role).toBe('admin')
    const { error: revertError } = await adminClient
      .from('user_profiles')
      .update({ role: 'member' })
      .eq('id', otherMemberId)
    expect(revertError).toBeNull()
    expect((await roleOf(otherMemberId))?.role).toBe('member')
  })

  it('still lets the service role change roles (server-side jobs, invites)', async () => {
    const { error } = await admin.from('user_profiles').update({ role: 'admin' }).eq('id', memberId)
    expect(error).toBeNull()
    expect((await roleOf(memberId))?.role).toBe('admin')
    await admin.from('user_profiles').update({ role: 'member' }).eq('id', memberId)
  })
})
