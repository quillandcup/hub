import { describe, it, expect } from 'vitest'
import { getTestApiBaseUrl, getTestAuthHeaders } from '../../helpers/supabase'

/**
 * The other API tests call route handlers in-process (tests/helpers/api-fetch.ts), which keeps
 * their coverage but skips Next's own server: routing, the proxy, body parsing and the real
 * Request/Response. These few go over HTTP to the built app (`npm run start`) so that layer
 * stays covered. Don't add more here without a reason an in-process call can't show.
 */
describe('HTTP smoke (built app server)', () => {
  const base = getTestApiBaseUrl()

  it('rejects an unauthenticated admin API call with 401, not a login redirect', async () => {
    const res = await fetch(`${base}/api/admin/events`, { redirect: 'manual' })
    expect(res.status).toBe(401)
  })

  it('accepts the service-role key in the Authorization header', async () => {
    const res = await fetch(`${base}/api/admin/events`, { headers: getTestAuthHeaders(), redirect: 'manual' })
    expect(res.status).toBe(200)
    expect(await res.json()).toHaveProperty('events')
  })

  it('answers a malformed JSON body with 400, not 500', async () => {
    const res = await fetch(`${base}/api/admin/events`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: '{ not json',
      redirect: 'manual',
    })
    expect(res.status).toBe(400)
  })
})
