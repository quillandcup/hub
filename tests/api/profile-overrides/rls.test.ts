import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestSupabaseClient } from '../../helpers/supabase'

/**
 * RLS + constraints on public.member_profile_overrides
 * (supabase/migrations/20260926000800_create_member_profile_overrides.sql), exercised with real
 * signed-in member/admin sessions -- the service-role client bypasses RLS and proves nothing.
 * Modeled on tests/api/commitments/rls.test.ts.
 */
describe('member_profile_overrides RLS', () => {
  const admin = getTestSupabaseAdminClient()
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const password = 'test-password-12345!'

  const authUserIds: string[] = []
  let memberAId: string
  let memberBId: string
  let memberAClient: ReturnType<typeof getTestSupabaseClient>
  let adminClient: ReturnType<typeof getTestSupabaseClient>
  const anonClient = getTestSupabaseClient()

  async function createUser(email: string, role: 'member' | 'admin') {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error || !data.user) throw new Error(`Failed to create test user ${email}: ${error?.message}`)
    authUserIds.push(data.user.id)
    await admin.from('user_profiles').update({ role }).eq('id', data.user.id)
    const client = getTestSupabaseClient()
    const { error: signInError } = await client.auth.signInWithPassword({ email, password })
    if (signInError) throw new Error(`Failed to sign in as ${email}: ${signInError.message}`)
    return client
  }

  async function resetOverrides() {
    await admin.from('member_profile_overrides').delete().in('member_id', [memberAId, memberBId])
  }

  beforeAll(async () => {
    const emailA = `profile-rls-a-${suffix}@example.com`
    const emailB = `profile-rls-b-${suffix}@example.com`
    const emailAdmin = `profile-rls-admin-${suffix}@example.com`

    const { data: members, error } = await admin
      .from('members')
      .insert([
        { name: 'Profile RLS Member A', email: emailA, joined_at: '2023-01-01', status: 'active' },
        { name: 'Profile RLS Member B', email: emailB, joined_at: '2023-01-01', status: 'active' },
      ])
      .select('id, email')
    if (error || !members) throw new Error(`Failed to create members: ${error?.message}`)
    memberAId = members.find((m) => m.email === emailA)!.id
    memberBId = members.find((m) => m.email === emailB)!.id

    memberAClient = await createUser(emailA, 'member')
    adminClient = await createUser(emailAdmin, 'admin')
  })

  afterAll(async () => {
    if (memberAId && memberBId) {
      await resetOverrides()
      await admin.from('members').delete().in('id', [memberAId, memberBId])
    }
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id).catch(() => {})
  })

  it('lets a member upsert, read and clear their own overrides', async () => {
    await resetOverrides()
    const { error: insertError } = await memberAClient
      .from('member_profile_overrides')
      .upsert({ member_id: memberAId, bio: 'Hello', twitter_url: 'https://x.com/a' }, { onConflict: 'member_id' })
    expect(insertError).toBeNull()

    const { error: updateError } = await memberAClient
      .from('member_profile_overrides')
      .upsert({ member_id: memberAId, bio: 'Hello again', twitter_url: null }, { onConflict: 'member_id' })
    expect(updateError).toBeNull()

    const { data } = await memberAClient.from('member_profile_overrides').select('bio, twitter_url')
    expect(data).toEqual([{ bio: 'Hello again', twitter_url: null }])
  })

  it("hides and protects another member's row", async () => {
    await resetOverrides()
    await admin.from('member_profile_overrides').insert({ member_id: memberBId, bio: 'B bio' })

    const { data: seen } = await memberAClient.from('member_profile_overrides').select('member_id').eq('member_id', memberBId)
    expect(seen).toEqual([])

    const { data: updated } = await memberAClient
      .from('member_profile_overrides')
      .update({ bio: 'hijacked' })
      .eq('member_id', memberBId)
      .select('bio')
    expect(updated).toEqual([])

    const { error: insertError } = await memberAClient
      .from('member_profile_overrides')
      .upsert({ member_id: memberBId, bio: 'hijacked' }, { onConflict: 'member_id' })
    expect(insertError).toBeTruthy()

    const { data: after } = await admin.from('member_profile_overrides').select('bio').eq('member_id', memberBId).single()
    expect(after!.bio).toBe('B bio')
  })

  it("blocks a member reassigning their row to another member", async () => {
    await resetOverrides()
    await admin.from('member_profile_overrides').insert({ member_id: memberAId, bio: 'A bio' })
    const { error } = await memberAClient
      .from('member_profile_overrides')
      .update({ member_id: memberBId })
      .eq('member_id', memberAId)
    expect(error).toBeTruthy()
  })

  it('does not let a member hard-delete their row', async () => {
    await resetOverrides()
    await admin.from('member_profile_overrides').insert({ member_id: memberAId, bio: 'A bio' })
    const { data: deleted } = await memberAClient
      .from('member_profile_overrides')
      .delete()
      .eq('member_id', memberAId)
      .select('member_id')
    expect(deleted ?? []).toEqual([])
    const { data: still } = await admin.from('member_profile_overrides').select('member_id').eq('member_id', memberAId)
    expect(still).toHaveLength(1)
  })

  it('shows anon nothing and rejects anon writes', async () => {
    await resetOverrides()
    await admin.from('member_profile_overrides').insert({ member_id: memberAId, bio: 'A bio' })
    const { data } = await anonClient.from('member_profile_overrides').select('member_id')
    expect(data ?? []).toEqual([])
    const { error } = await anonClient
      .from('member_profile_overrides')
      .upsert({ member_id: memberBId, bio: 'anon' }, { onConflict: 'member_id' })
    expect(error).toBeTruthy()
  })

  it("lets an admin session read and write any member's row (the sudo path)", async () => {
    await resetOverrides()
    const { error } = await adminClient
      .from('member_profile_overrides')
      .upsert({ member_id: memberBId, facebook_url: 'https://facebook.com/member.b' }, { onConflict: 'member_id' })
    expect(error).toBeNull()
    const { data } = await adminClient.from('member_profile_overrides').select('facebook_url').eq('member_id', memberBId)
    expect(data).toEqual([{ facebook_url: 'https://facebook.com/member.b' }])
  })

  it('enforces the column constraints (http(s) links, bio length, no blank bio)', async () => {
    await resetOverrides()
    for (const bad of [
      { twitter_url: 'javascript:alert(1)' },
      { facebook_url: 'facebook.com/no-scheme' },
      { bio: 'a'.repeat(1001) },
      { bio: '   ' },
    ]) {
      const { error } = await memberAClient
        .from('member_profile_overrides')
        .upsert({ member_id: memberAId, ...bad }, { onConflict: 'member_id' })
      expect(error?.code, JSON.stringify(bad)).toBe('23514')
    }
  })

  it("accepts '' (cleared) for every field, distinct from NULL (never set)", async () => {
    await resetOverrides()
    const { error } = await memberAClient
      .from('member_profile_overrides')
      .upsert({ member_id: memberAId, bio: '', facebook_url: '', twitter_url: null }, { onConflict: 'member_id' })
    expect(error).toBeNull()
    const { data } = await memberAClient.from('member_profile_overrides').select('bio, facebook_url, twitter_url')
    expect(data).toEqual([{ bio: '', facebook_url: '', twitter_url: null }])
  })

  it('is removed with its member (ON DELETE CASCADE)', async () => {
    const { data: temp } = await admin
      .from('members')
      .insert({ name: 'Profile RLS Temp', email: `profile-rls-temp-${suffix}@example.com`, joined_at: '2023-01-01', status: 'active' })
      .select('id')
      .single()
    await admin.from('member_profile_overrides').insert({ member_id: temp!.id, bio: 'temp' })
    await admin.from('members').delete().eq('id', temp!.id)
    const { data } = await admin.from('member_profile_overrides').select('member_id').eq('member_id', temp!.id)
    expect(data).toEqual([])
  })
})
