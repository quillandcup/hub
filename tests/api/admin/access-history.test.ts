import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
import { apiFetch } from '../../helpers/api-fetch'

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
  const CHROME_ON_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'
const CHROME_ON_MAC_DEVICE = { browser: 'Chrome', browser_version: '126.0', os: 'macOS', os_version: null, device_type: 'desktop' }

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
    // Session 1 predates user agent capture except for its last event;
    // session 2 has none at all.
    const { error: insertError } = await supabase.from('access_events').insert([
      { user_id: testUserId, path: '/dashboard', is_page: true, created_at: minutesAgo(120) },
      { user_id: testUserId, path: '/api/dashboard/stats', is_page: false, created_at: minutesAgo(119) },
      { user_id: testUserId, path: '/members', is_page: true, created_at: minutesAgo(118), user_agent: CHROME_ON_MAC, device: CHROME_ON_MAC_DEVICE },
      { user_id: testUserId, path: '/profile', is_page: true, created_at: minutesAgo(10) },
    ])
    if (insertError) throw new Error(`Failed to insert access events: ${insertError.message}`)
  })

  afterAll(async () => {
    await supabase.from('access_events').delete().eq('user_id', testUserId)
    await supabase.auth.admin.deleteUser(testUserId).catch(() => {})
  })

  it('returns 401 without auth', async () => {
    const res = await apiFetch(`${base}/api/admin/users/${testUserId}/access-history`)
    expect(res.status).toBe(401)
  })

  it('groups events into sessions by gap and returns them newest-first', async () => {
    const res = await apiFetch(`${base}/api/admin/users/${testUserId}/access-history`, {
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
    const res = await apiFetch(`${base}/api/admin/users/${testUserId}/access-history`, {
      headers: getTestAuthHeaders(),
    })

    const body = await res.json()
    const oldestSession = body.sessions[1]

    expect(oldestSession.event_count).toBe(3)
    expect(oldestSession.pages).toEqual(['/dashboard', '/members'])
  })

  it('newest session contains only its own page', async () => {
    const res = await apiFetch(`${base}/api/admin/users/${testUserId}/access-history`, {
      headers: getTestAuthHeaders(),
    })

    const body = await res.json()
    const newestSession = body.sessions[0]

    expect(newestSession.event_count).toBe(1)
    expect(newestSession.pages).toEqual(['/profile'])
  })

  it("returns each session's user agent, or null when none was recorded", async () => {
    const res = await apiFetch(`${base}/api/admin/users/${testUserId}/access-history`, {
      headers: getTestAuthHeaders(),
    })

    const body = await res.json()
    const [newest, oldest] = body.sessions
    expect(oldest.user_agent).toBe(CHROME_ON_MAC)
    expect(newest.user_agent).toBeNull()
    // The device rides along, and is what is left once the raw string has been removed.
    expect(oldest.device).toEqual(CHROME_ON_MAC_DEVICE)
    expect(newest.device).toBeNull()
  })

  it('rejects a device that is not a JSON object', async () => {
    const { error } = await supabase.from('access_events').insert({ user_id: testUserId, path: '/dashboard', is_page: true, device: ['Chrome'] })
    expect(error?.code).toBe('23514') // check_violation
  })

  it('rejects a user agent longer than 512 characters', async () => {
    const { error } = await supabase.from('access_events').insert({
      user_id: testUserId,
      path: '/dashboard',
      is_page: true,
      user_agent: 'x'.repeat(513),
    })
    expect(error?.code).toBe('23514') // check_violation
  })

  it('rejects a GA browser ID longer than 64 characters', async () => {
    const { error } = await supabase.from('access_events').insert({
      user_id: testUserId,
      path: '/dashboard',
      is_page: true,
      ga_client_id: '1'.repeat(65),
    })
    expect(error?.code).toBe('23514') // check_violation
  })

  it('reports no linked auth session when events were inserted without a session_id', async () => {
    const res = await apiFetch(`${base}/api/admin/users/${testUserId}/access-history`, {
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
