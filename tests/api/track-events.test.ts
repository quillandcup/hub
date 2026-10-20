import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }))

import { POST } from '@/app/api/track/events/route'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { TRACK_EVENTS_PATH } from '@/lib/analytics/client'
import { SUDO_COOKIE_NAME, signSudoCookie } from '@/lib/sudo-cookie'

const USER = { id: '11111111-1111-1111-1111-111111111111', email: 'a@example.com' }
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'
const SESSION = '33333333-3333-4333-8333-333333333333'

function event(overrides: Record<string, unknown> = {}) {
  return {
    messageId: crypto.randomUUID(),
    sessionId: SESSION,
    event: 'onair_join_clicked',
    properties: { live: true, room_size: 2 },
    timestamp: new Date().toISOString(),
    context: { route: '/dashboard', viewport: 'lg' },
    ...overrides,
  }
}

function setup(upsertError: { message: string } | null = null) {
  const upsert = vi.fn().mockResolvedValue({ error: upsertError })
  const supabase = { from: vi.fn().mockReturnValue({ upsert }) }
  vi.mocked(createClient).mockResolvedValue(supabase as any)
  return { upsert, supabase }
}

function makeRequest(body: unknown, cookie?: string) {
  return new NextRequest(`http://localhost${TRACK_EVENTS_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'user-agent': 'TestAgent/1.0', ...(cookie ? { cookie } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const batch = (events: unknown[]) => ({ sentAt: new Date().toISOString(), events })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SUDO_SECRET = 'test-sudo-secret'
  vi.mocked(getCurrentUser).mockResolvedValue(USER)
})

describe('POST /api/track/events', () => {
  it('returns 401 and stores nothing without a session', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const { upsert } = setup()
    const res = await POST(makeRequest(batch([event()])))
    expect(res.status).toBe(401)
    expect(upsert).not.toHaveBeenCalled()
  })

  it("stores the batch as the signed-in user, skipping events it already has", async () => {
    const { upsert, supabase } = setup()
    const res = await POST(makeRequest(batch([event(), event({ event: 'page_viewed', properties: { route: '/dashboard' } })])))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ stored: 2, rejected: [] })
    expect(supabase.from).toHaveBeenCalledWith('analytics_events')
    const [rows, options] = upsert.mock.calls[0]
    expect(options).toEqual({ onConflict: 'user_id,message_id', ignoreDuplicates: true })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      user_id: USER.id,
      session_id: SESSION,
      event: 'onair_join_clicked',
      properties: { live: true, room_size: 2 },
      context: { route: '/dashboard', viewport: 'lg', user_agent: 'TestAgent/1.0' },
      sudo: false,
    })
  })

  it('stores what is valid and reports the rest', async () => {
    const { upsert } = setup()
    const res = await POST(makeRequest(batch([event(), event({ event: 'made_up' }), event({ properties: { live: 'yes' } })])))
    expect(await res.json()).toEqual({
      stored: 1,
      rejected: [
        { index: 1, reason: 'unknown event' },
        { index: 2, reason: 'onair_join_clicked.live must be a boolean' },
      ],
    })
    expect(upsert.mock.calls[0][0]).toHaveLength(1)
  })

  it('never stores properties the plan does not declare', async () => {
    const { upsert } = setup()
    await POST(makeRequest(batch([event({ properties: { live: true, room_size: 1, email: 'a@example.com' } })])))
    expect(upsert.mock.calls[0][0][0].properties).toEqual({ live: true, room_size: 1 })
  })

  it('writes nothing when every event is rejected', async () => {
    const { upsert } = setup()
    const res = await POST(makeRequest(batch([event({ event: 'made_up' })])))
    expect(res.status).toBe(200)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('flags events sent while an admin is viewing as a member', async () => {
    const { upsert } = setup()
    const cookie = `${SUDO_COOKIE_NAME}=${signSudoCookie(USER.id, MEMBER_ID)}`
    await POST(makeRequest(batch([event()]), cookie))
    expect(upsert.mock.calls[0][0][0].sudo).toBe(true)
  })

  it('ignores a sudo cookie signed for a different admin', async () => {
    const { upsert } = setup()
    const cookie = `${SUDO_COOKIE_NAME}=${signSudoCookie('99999999-9999-9999-9999-999999999999', MEMBER_ID)}`
    await POST(makeRequest(batch([event()]), cookie))
    expect(upsert.mock.calls[0][0][0].sudo).toBe(false)
  })

  it.each([['not json'], [{}], [{ sentAt: 'now', events: [] }], [{ events: 'x', sentAt: new Date().toISOString() }]])(
    'rejects the body %j with 400',
    async (body) => {
      const { upsert } = setup()
      const res = await POST(makeRequest(body))
      expect(res.status).toBe(400)
      expect(upsert).not.toHaveBeenCalled()
    }
  )

  it('returns 500 when the write fails', async () => {
    setup({ message: 'boom' })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(makeRequest(batch([event()])))
    expect(res.status).toBe(500)
    spy.mockRestore()
  })
})
