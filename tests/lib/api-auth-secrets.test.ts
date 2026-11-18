import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }))

import { createApiAuth } from '@/lib/supabase/api-auth'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'

const KEY = 'service-role-key-for-test'
const CRON = 'cron-secret-for-test'

function request(authorization?: string) {
  return new NextRequest('http://localhost/api/test', { headers: authorization ? { authorization } : {} })
}

describe('createApiAuth secrets', () => {
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, cron: process.env.CRON_SECRET }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = KEY
    process.env.CRON_SECRET = CRON
    vi.mocked(createClient).mockResolvedValue({ cookieClient: true } as never)
    vi.mocked(getCurrentUser).mockResolvedValue(null)
  })
  afterEach(() => {
    for (const [name, value] of [['NEXT_PUBLIC_SUPABASE_URL', saved.url], ['SUPABASE_SERVICE_ROLE_KEY', saved.key], ['CRON_SECRET', saved.cron]] as const) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  it('accepts exactly "Bearer <service role key>"', async () => {
    const auth = await createApiAuth(request(`Bearer ${KEY}`))
    expect(auth.user?.id).toBe('service-role')
    expect(createClient).not.toHaveBeenCalled()
  })

  it('rejects the key embedded in a longer header, or sent without Bearer', async () => {
    for (const header of [`Bearer ${KEY}extra`, `Bearer x${KEY}`, `Basic ${KEY}`, `Bearer a ${KEY} b`, KEY]) {
      const auth = await createApiAuth(request(header))
      expect(auth.user, header).toBeNull()
    }
  })

  it('rejects a wrong key', async () => {
    const auth = await createApiAuth(request('Bearer not-the-key'))
    expect(auth.user).toBeNull()
  })

  it('accepts exactly "Bearer <cron secret>" and rejects a wrong or embedded one', async () => {
    expect((await createApiAuth(request(`Bearer ${CRON}`))).user?.id).toBe('cron')
    expect((await createApiAuth(request('Bearer wrong-cron'))).user).toBeNull()
    expect((await createApiAuth(request(`Bearer ${CRON}-and-more`))).user).toBeNull()
  })

  it('does not treat an unset cron secret as a match', async () => {
    delete process.env.CRON_SECRET
    expect((await createApiAuth(request('Bearer undefined'))).user).toBeNull()
  })

  it('falls through to cookie auth with no header', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1' } as never)
    const auth = await createApiAuth(request())
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(auth.user).toEqual({ id: 'user-1' })
  })
})
