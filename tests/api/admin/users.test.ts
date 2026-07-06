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

  it('GET includes allStaff and linked profile fields on each user', async () => {
    const res = await fetch(`${base}/api/admin/users`, {
      headers: getTestAuthHeaders(),
    })

    expect(res.ok).toBe(true)
    const body = await res.json()

    expect(Array.isArray(body.allStaff)).toBe(true)

    const found = body.users.find((u: any) => u.id === testUserId)
    expect(found).toBeTruthy()
    // Fields exist on every user (null when unlinked)
    expect('staffId' in found).toBe(true)
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
      body: JSON.stringify({ features: ['streaks', 'hiatus_tracking'] }),
    })

    expect(res.ok).toBe(true)

    const { data: rows } = await supabase
      .from('user_feature_previews')
      .select('feature_key')
      .eq('user_id', testUserId)

    const keys = (rows ?? []).map((r) => r.feature_key).sort()
    expect(keys).toEqual(['hiatus_tracking', 'streaks'])
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

  // ── PATCH staffId ─────────────────────────────────────────────────────────

  describe('PATCH staffId — staff and member linking', () => {
    const staffEmail = `staff-link-test-${ts}@example.com`
    let staffRecordId: string

    beforeAll(async () => {
      // Seed a staff record with no user_id
      const { data, error } = await supabase
        .from('staff')
        .insert({ name: 'Test Staffer', email: staffEmail, role: 'staff' })
        .select('id')
        .single()
      if (error || !data) throw new Error(`Failed to create test staff: ${error?.message}`)
      staffRecordId = data.id

      // Seed a matching member record so we can verify members.user_id is updated too
      await supabase.from('members').insert({
        email: staffEmail,
        name: 'Test Staffer',
        joined_at: new Date().toISOString(),
        status: 'active',
        source: 'staff',
      })
    })

    afterAll(async () => {
      await supabase.from('staff').delete().eq('id', staffRecordId)
      await supabase.from('members').delete().eq('email', staffEmail)
    })

    it('PATCH links user to a staff record and propagates to members', async () => {
      const res = await fetch(`${base}/api/admin/users/${testUserId}`, {
        method: 'PATCH',
        headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId: staffRecordId }),
      })

      expect(res.ok).toBe(true)

      const [{ data: staffRow }, { data: memberRow }] = await Promise.all([
        supabase.from('staff').select('user_id').eq('id', staffRecordId).single(),
        supabase.from('members').select('user_id').eq('email', staffEmail).single(),
      ])

      expect(staffRow?.user_id).toBe(testUserId)
      expect(memberRow?.user_id).toBe(testUserId)
    })

    it('GET reflects the linked staff on the user', async () => {
      const res = await fetch(`${base}/api/admin/users`, {
        headers: getTestAuthHeaders(),
      })

      const body = await res.json()
      const found = body.users.find((u: any) => u.id === testUserId)

      expect(found.staffId).toBe(staffRecordId)
      expect(found.staffName).toBe('Test Staffer')
      expect(found.staffRole).toBe('staff')

      // Staff should no longer appear in allStaff (it's now linked)
      const inAvailable = body.allStaff.find((s: any) => s.id === staffRecordId)
      expect(inAvailable?.user_id).toBe(testUserId)
    })

    it('PATCH with staffId: null unlinks from staff and member', async () => {
      const res = await fetch(`${base}/api/admin/users/${testUserId}`, {
        method: 'PATCH',
        headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId: null }),
      })

      expect(res.ok).toBe(true)

      const [{ data: staffRow }, { data: memberRow }] = await Promise.all([
        supabase.from('staff').select('user_id').eq('id', staffRecordId).single(),
        supabase.from('members').select('user_id').eq('email', staffEmail).single(),
      ])

      expect(staffRow?.user_id).toBeNull()
      expect(memberRow?.user_id).toBeNull()
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
