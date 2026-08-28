import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestSupabaseClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'

/**
 * Integration tests for POST /api/admin/users/[id]/revoke-sessions.
 *
 * Confirms this is a real revocation (auth.sessions row deleted server-side,
 * not just a client-side sign-out) by signing in a test user, force-revoking
 * via the admin route, then verifying the previously-valid access token is
 * rejected on the next auth.getUser() call — the same check this app's own
 * middleware runs on every request.
 */
describe('Admin Revoke User Sessions API', () => {
  const supabaseAdmin = getTestSupabaseAdminClient()
  const base = getTestApiBaseUrl()
  const ts = Date.now()
  const testEmail = `revoke-sessions-test-${ts}@example.com`
  const testPassword = `Test-Password-${ts}!`

  let testUserId: string

  beforeAll(async () => {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    })
    if (error || !data.user) throw new Error(`Failed to create test user: ${error?.message}`)
    testUserId = data.user.id
  })

  afterAll(async () => {
    await supabaseAdmin.auth.admin.deleteUser(testUserId).catch(() => {})
  })

  it('returns 401 without auth', async () => {
    const res = await fetch(`${base}/api/admin/users/${testUserId}/revoke-sessions`, { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it("revokes the user's active session so their access token stops working", async () => {
    const anonClient = getTestSupabaseClient()
    const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    })
    if (signInError || !signInData.session) {
      throw new Error(`Failed to sign in test user: ${signInError?.message}`)
    }
    const accessToken = signInData.session.access_token

    const before = await anonClient.auth.getUser(accessToken)
    expect(before.error).toBeNull()

    const res = await fetch(`${base}/api/admin/users/${testUserId}/revoke-sessions`, {
      method: 'POST',
      headers: getTestAuthHeaders(),
    })
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.success).toBe(true)

    const after = await anonClient.auth.getUser(accessToken)
    expect(after.error).not.toBeNull()
  })
})
