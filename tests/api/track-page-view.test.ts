import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }))

import { POST } from '@/app/api/track/page-view/route'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { PAGE_VIEW_PATH } from '@/lib/page-views'
import { SUDO_COOKIE_NAME, signSudoCookie } from '@/lib/sudo-cookie'

const USER = { id: '11111111-1111-1111-1111-111111111111', email: 'a@example.com' }
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'
const AUTH_SESSION_ID = '33333333-3333-3333-3333-333333333333'

function fakeAccessToken(sessionId: string) {
  const payload = Buffer.from(JSON.stringify({ session_id: sessionId })).toString('base64url')
  return `header.${payload}.sig`
}

function setup(insertError: { message: string } | null = null) {
  const insert = vi.fn().mockResolvedValue({ error: insertError })
  const supabase = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: fakeAccessToken(AUTH_SESSION_ID) } } }),
    },
    from: vi.fn().mockReturnValue({ insert }),
  }
  vi.mocked(createClient).mockResolvedValue(supabase as any)
  return { insert, supabase }
}

function makeRequest(body: unknown, cookie?: string) {
  return new NextRequest(`http://localhost${PAGE_VIEW_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SUDO_SECRET = 'test-sudo-secret'
  vi.mocked(getCurrentUser).mockResolvedValue(USER)
})

describe('POST /api/track/page-view', () => {
  it('returns 401 and records nothing without a session', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const { insert } = setup()
    const res = await POST(makeRequest({ path: '/dashboard' }))
    expect(res.status).toBe(401)
    expect(insert).not.toHaveBeenCalled()
  })

  it('records a page view for the signed-in user with their auth session id', async () => {
    const { insert, supabase } = setup()
    const res = await POST(makeRequest({ path: '/my-prickles/all' }))
    expect(res.status).toBe(204)
    expect(supabase.from).toHaveBeenCalledWith('access_events')
    expect(insert).toHaveBeenCalledWith({
      user_id: USER.id,
      path: '/my-prickles/all',
      is_page: true,
      session_id: AUTH_SESSION_ID,
      acting_as_member_id: null,
    })
  })

  it.each([
    ['an API path', { path: '/api/members' }],
    ['a full URL', { path: 'https://evil.example/x' }],
    ['a path with a query', { path: '/a?b=1' }],
    ['no path', {}],
    ['a non-string path', { path: 5 }],
  ])('rejects %s with 400', async (_label, body) => {
    const { insert } = setup()
    const res = await POST(makeRequest(body))
    expect(res.status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects a body that is not JSON', async () => {
    const { insert } = setup()
    const res = await POST(makeRequest('not json'))
    expect(res.status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })

  it('records which member an admin was viewing as during sudo', async () => {
    const { insert } = setup()
    const cookie = `${SUDO_COOKIE_NAME}=${signSudoCookie(USER.id, MEMBER_ID)}`
    await POST(makeRequest({ path: '/dashboard' }, cookie))
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ acting_as_member_id: MEMBER_ID }))
  })

  it('ignores a sudo cookie signed for a different admin', async () => {
    const { insert } = setup()
    const cookie = `${SUDO_COOKIE_NAME}=${signSudoCookie('99999999-9999-9999-9999-999999999999', MEMBER_ID)}`
    await POST(makeRequest({ path: '/dashboard' }, cookie))
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ acting_as_member_id: null }))
  })

  it('returns 500 when the insert fails', async () => {
    setup({ message: 'boom' })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(makeRequest({ path: '/dashboard' }))
    expect(res.status).toBe(500)
    spy.mockRestore()
  })
})
