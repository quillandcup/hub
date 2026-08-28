import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'

/**
 * Integration tests for GET /api/admin/users/[id]/access-history.
 *
 * Covers the get_access_sessions() sessionization: events with no >30min
 * gap between them group into one session, and only is_page rows show up
 * in the returned page trail.
 */
describe('Admin User Access History API', () => {
  const supabase = getTestSupabaseAdminClient()
  const base = getTestApiBaseUrl()
  const ts = Date.now()
  const testEmail = `access-history-test-${ts}@example.com`

  let testUserId: string

  beforeAll(async () => {
    const { data, error } = await supabase.auth.admin.createUser({
      email: testEmail,
      email_confirm: true,
    })
    if (error || !data.user) throw new Error(`Failed to create test user: ${error?.message}`)
    testUserId = data.user.id

    const minutesAgo = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString()

    // Session 1 (older): two page views and one API call, all within a few
    // minutes of each other, starting ~120 minutes ago.
    // Session 2 (newer): one page view, starting ~10 minutes ago — more
    // than 30 minutes after session 1's last event, so it's a separate session.
    await supabase.from('access_events').insert([
      { user_id: testUserId, path: '/dashboard', is_page: true, created_at: minutesAgo(120) },
      { user_id: testUserId, path: '/api/dashboard/stats', is_page: false, created_at: minutesAgo(119) },
      { user_id: testUserId, path: '/members', is_page: true, created_at: minutesAgo(118) },
      { user_id: testUserId, path: '/profile', is_page: true, created_at: minutesAgo(10) },
    ])
  })

  afterAll(async () => {
    await supabase.from('access_events').delete().eq('user_id', testUserId)
    await supabase.auth.admin.deleteUser(testUserId).catch(() => {})
  })

  it('returns 401 without auth', async () => {
    const res = await fetch(`${base}/api/admin/users/${testUserId}/access-history`)
    expect(res.status).toBe(401)
  })

  it('groups events into sessions by gap and returns them newest-first', async () => {
    const res = await fetch(`${base}/api/admin/users/${testUserId}/access-history`, {
      headers: getTestAuthHeaders(),
    })

    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(Array.isArray(body.sessions)).toBe(true)
    expect(body.sessions).toHaveLength(2)

    const [newest, oldest] = body.sessions
    expect(new Date(newest.session_start).getTime()).toBeGreaterThan(new Date(oldest.session_start).getTime())
  })

  it('excludes API-only events from the page trail but still counts them toward the session', async () => {
    const res = await fetch(`${base}/api/admin/users/${testUserId}/access-history`, {
      headers: getTestAuthHeaders(),
    })

    const body = await res.json()
    const oldestSession = body.sessions[1]

    expect(oldestSession.event_count).toBe(3)
    expect(oldestSession.pages).toEqual(['/dashboard', '/members'])
  })

  it('newest session contains only its own page', async () => {
    const res = await fetch(`${base}/api/admin/users/${testUserId}/access-history`, {
      headers: getTestAuthHeaders(),
    })

    const body = await res.json()
    const newestSession = body.sessions[0]

    expect(newestSession.event_count).toBe(1)
    expect(newestSession.pages).toEqual(['/profile'])
  })

  it('reports no linked auth session when events were inserted without a session_id', async () => {
    const res = await fetch(`${base}/api/admin/users/${testUserId}/access-history`, {
      headers: getTestAuthHeaders(),
    })

    const body = await res.json()
    for (const session of body.sessions) {
      expect(session.auth_session_id).toBeNull()
      expect(session.session_active).toBe(false)
      expect(session.auth_session_created_at).toBeNull()
    }
  })
})
