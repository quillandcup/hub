import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'

/**
 * Integration tests for the admin users API.
 *
 * Covers:
 * - GET  /api/admin/users          — list users
 * - POST /api/admin/users          — invite user
 * - PATCH /api/admin/users/[id]    — update role and/or feature flags
 * - DELETE /api/admin/users/[id]   — delete user
 *
 * Auth guard tests are included for each method.
 */
describe('Admin Users API', () => {
  const supabase = getTestSupabaseAdminClient()
  const base = getTestApiBaseUrl()
  const ts = Date.now()
  const testEmail = `admin-users-test-${ts}@example.com`

  let testUserId: string

  beforeAll(async () => {
    // Create a real auth user directly so we have something to operate on.
    // email_confirm: true avoids sending a confirmation email.
    const { data, error } = await supabase.auth.admin.createUser({
      email: testEmail,
      email_confirm: true,
    })
    if (error || !data.user) throw new Error(`Failed to create test user: ${error?.message}`)
    testUserId = data.user.id
  })

  afterAll(async () => {
    // Best-effort cleanup — the DELETE test may have already removed this user
    await supabase.auth.admin.deleteUser(testUserId).catch(() => {})
  })

  // ── Auth guard ─────────────────────────────────────────────────────────────

  it('GET returns 401 without auth', async () => {
    const res = await fetch(`${base}/api/admin/users`)
    expect(res.status).toBe(401)
  })

  it('POST returns 401 without auth', async () => {
    const res = await fetch(`${base}/api/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x@example.com' }),
    })
    expect(res.status).toBe(401)
  })

  it('PATCH returns 401 without auth', async () => {
    const res = await fetch(`${base}/api/admin/users/${testUserId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    })
    expect(res.status).toBe(401)
  })

  it('DELETE returns 401 without auth', async () => {
    const res = await fetch(`${base}/api/admin/users/${testUserId}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(401)
  })

  // ── GET /api/admin/users ───────────────────────────────────────────────────

  it('GET returns a list of users', async () => {
    const res = await fetch(`${base}/api/admin/users`, {
      headers: getTestAuthHeaders(),
    })

    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(Array.isArray(body.users)).toBe(true)
  })

  it('GET includes the test user with email, role, and features fields', async () => {
    const res = await fetch(`${base}/api/admin/users`, {
      headers: getTestAuthHeaders(),
    })

    const body = await res.json()
    const found = body.users.find((u: any) => u.id === testUserId)

    expect(found).toBeTruthy()
    expect(found.email).toBe(testEmail)
    expect(typeof found.role).toBe('string')
    expect(Array.isArray(found.features)).toBe(true)
    expect(typeof found.createdAt).toBe('string')
  })

  it('GET includes allMembers and linked profile fields on each user', async () => {
    const res = await fetch(`${base}/api/admin/users`, {
      headers: getTestAuthHeaders(),
    })

    expect(res.ok).toBe(true)
    const body = await res.json()

    expect(Array.isArray(body.allMembers)).toBe(true)

    const found = body.users.find((u: any) => u.id === testUserId)
    expect(found).toBeTruthy()
    // Fields exist on every user (null when unlinked)
    expect('staffName' in found).toBe(true)
    expect('staffRole' in found).toBe(true)
    expect('memberId' in found).toBe(true)
    expect('memberName' in found).toBe(true)
  })

  // ── PATCH /api/admin/users/[id] ───────────────────────────────────────────

  it('PATCH updates role', async () => {
    const res = await fetch(`${base}/api/admin/users/${testUserId}`, {
      method: 'PATCH',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    })

    expect(res.ok).toBe(true)

    // Confirm the change is reflected in the DB
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', testUserId)
      .single()

    expect(profile?.role).toBe('admin')
  })

  it('PATCH updates feature flags (add)', async () => {
    const res = await fetch(`${base}/api/admin/users/${testUserId}`, {
      method: 'PATCH',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ features: ['streaks', 'prickle_picker'] }),
    })

    expect(res.ok).toBe(true)

    const { data: rows } = await supabase
      .from('user_feature_previews')
      .select('feature_key')
      .eq('user_id', testUserId)

    const keys = (rows ?? []).map((r) => r.feature_key).sort()
    expect(keys).toEqual(['prickle_picker', 'streaks'])
  })

  it('PATCH replaces feature flags (remove one)', async () => {
    const res = await fetch(`${base}/api/admin/users/${testUserId}`, {
      method: 'PATCH',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ features: ['streaks'] }),
    })

    expect(res.ok).toBe(true)

    const { data: rows } = await supabase
      .from('user_feature_previews')
      .select('feature_key')
      .eq('user_id', testUserId)

    const keys = (rows ?? []).map((r) => r.feature_key)
    expect(keys).toEqual(['streaks'])
  })

  it('PATCH clears all feature flags when given empty array', async () => {
    const res = await fetch(`${base}/api/admin/users/${testUserId}`, {
      method: 'PATCH',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ features: [] }),
    })

    expect(res.ok).toBe(true)

    const { data: rows } = await supabase
      .from('user_feature_previews')
      .select('feature_key')
      .eq('user_id', testUserId)

    expect(rows ?? []).toHaveLength(0)
  })

  it('PATCH updates role and features together', async () => {
    const res = await fetch(`${base}/api/admin/users/${testUserId}`, {
      method: 'PATCH',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'member', features: ['member_overrides'] }),
    })

    expect(res.ok).toBe(true)

    const [{ data: profile }, { data: rows }] = await Promise.all([
      supabase.from('user_profiles').select('role').eq('id', testUserId).single(),
      supabase.from('user_feature_previews').select('feature_key').eq('user_id', testUserId),
    ])

    expect(profile?.role).toBe('member')
    expect((rows ?? []).map((r) => r.feature_key)).toEqual(['member_overrides'])
  })

  // ── PATCH memberId ────────────────────────────────────────────────────────

  describe('PATCH memberId — member linking, independent of staff', () => {
    const memberEmail = `member-link-test-${ts}@example.com`
    let memberRecordId: string

    beforeAll(async () => {
      // Seed a member record with no user_id, and a staff record pointing at
      // it via member_id — linking a *different* user to the member below
      // must not touch the staff row, proving the two are independent.
      const { data, error } = await supabase
        .from('members')
        .insert({
          email: memberEmail,
          name: 'Test Member',
          joined_at: new Date().toISOString(),
          status: 'active',
          source: 'staff',
        })
        .select('id')
        .single()
      if (error || !data) throw new Error(`Failed to create test member: ${error?.message}`)
      memberRecordId = data.id

      await supabase.from('staff').insert({
        name: 'Test Member',
        email: memberEmail,
        role: 'staff',
        member_id: memberRecordId,
      })
    })

    afterAll(async () => {
      await supabase.from('staff').delete().eq('member_id', memberRecordId)
      await supabase.from('members').delete().eq('id', memberRecordId)
    })

    it('PATCH links user to a member record', async () => {
      const res = await fetch(`${base}/api/admin/users/${testUserId}`, {
        method: 'PATCH',
        headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: memberRecordId }),
      })

      expect(res.ok).toBe(true)

      const { data: memberRow } = await supabase
        .from('members')
        .select('user_id')
        .eq('id', memberRecordId)
        .single()

      expect(memberRow?.user_id).toBe(testUserId)
    })

    it('GET reflects the linked member and its derived staff role', async () => {
      const res = await fetch(`${base}/api/admin/users`, {
        headers: getTestAuthHeaders(),
      })

      const body = await res.json()
      const found = body.users.find((u: any) => u.id === testUserId)

      expect(found.memberId).toBe(memberRecordId)
      expect(found.memberName).toBe('Test Member')
      // Staff role is derived via staff.member_id, not a separate link.
      expect(found.staffName).toBe('Test Member')
      expect(found.staffRole).toBe('staff')
    })

    it('PATCH with memberId: null unlinks the member only', async () => {
      const res = await fetch(`${base}/api/admin/users/${testUserId}`, {
        method: 'PATCH',
        headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: null }),
      })

      expect(res.ok).toBe(true)

      const [{ data: memberRow }, { data: staffRow }] = await Promise.all([
        supabase.from('members').select('user_id').eq('id', memberRecordId).single(),
        supabase.from('staff').select('member_id').eq('member_id', memberRecordId).maybeSingle(),
      ])

      expect(memberRow?.user_id).toBeNull()
      // Staff's member_id link is untouched by unlinking the login.
      expect(staffRow?.member_id).toBe(memberRecordId)
    })
  })

  // ── POST /api/admin/users ──────────────────────────────────────────────────

  it('POST rejects missing email', async () => {
    const res = await fetch(`${base}/api/admin/users`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/email/i)
  })

  it('POST invites a new user', async () => {
    const inviteEmail = `admin-invite-${ts}@example.com`

    const res = await fetch(`${base}/api/admin/users`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail }),
    })

    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.user.email).toBe(inviteEmail)

    // Clean up the invited user
    await supabase.auth.admin.deleteUser(body.user.id)
  })

  it('POST links the new auth user to a matching unlinked member (best-effort)', async () => {
    const inviteEmail = `admin-invite-linked-${ts}@example.com`

    const { data: member, error } = await supabase
      .from('members')
      .insert({
        email: inviteEmail,
        name: 'Invite Target',
        joined_at: new Date().toISOString(),
        status: 'active',
        source: 'staff',
      })
      .select('id')
      .single()
    if (error || !member) throw new Error(`Failed to create invite-target member: ${error?.message}`)

    try {
      const res = await fetch(`${base}/api/admin/users`, {
        method: 'POST',
        headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail }),
      })

      expect(res.ok).toBe(true)
      const body = await res.json()

      const { data: memberRow } = await supabase
        .from('members')
        .select('user_id')
        .eq('id', member.id)
        .single()
      expect(memberRow?.user_id).toBe(body.user.id)

      // Clean up the invited user
      await supabase.auth.admin.deleteUser(body.user.id)
    } finally {
      await supabase.from('members').delete().eq('id', member.id)
    }
  })

  // ── DELETE /api/admin/users/[id] ──────────────────────────────────────────

  it('DELETE removes the user', async () => {
    // Create a dedicated user to delete so afterAll cleanup doesn't need to handle it
    const { data } = await supabase.auth.admin.createUser({
      email: `admin-delete-target-${ts}@example.com`,
      email_confirm: true,
    })
    const deleteTargetId = data.user!.id

    const res = await fetch(`${base}/api/admin/users/${deleteTargetId}`, {
      method: 'DELETE',
      headers: getTestAuthHeaders(),
    })

    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.success).toBe(true)

    // Confirm the auth user is gone
    const { data: gone, error } = await supabase.auth.admin.getUserById(deleteTargetId)
    expect(gone?.user ?? null).toBeNull()
    expect(error).toBeTruthy()
  })
})
