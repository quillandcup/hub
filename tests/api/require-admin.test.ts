import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// We test requireAdmin by mocking createApiAuth's dependencies.
// The function under test is exported from api-auth.ts.

// Mock the supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { requireAdmin } from '@/lib/supabase/api-auth'
import { createClient } from '@/lib/supabase/server'

function makeRequest(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (authHeader) headers['authorization'] = authHeader
  return new NextRequest('http://localhost/api/test', { headers })
}

function makeSupabaseMock(user: any, role: string | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: role ? { role } : null,
        error: null,
      }),
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret'
})

describe('requireAdmin', () => {
  it('returns forbidden=true when no user session', async () => {
    const mockSupabase = makeSupabaseMock(null, null)
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any)

    const result = await requireAdmin(makeRequest())
    expect(result.user).toBeNull()
    expect(result.forbidden).toBe(true)
  })

  it('returns forbidden=true for authenticated member (non-admin)', async () => {
    const mockSupabase = makeSupabaseMock({ id: 'user-1', email: 'a@b.com' }, 'member')
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any)

    const result = await requireAdmin(makeRequest())
    expect(result.user).not.toBeNull()
    expect(result.forbidden).toBe(true)
  })

  it('returns forbidden=false for authenticated admin', async () => {
    const mockSupabase = makeSupabaseMock({ id: 'user-1', email: 'a@b.com' }, 'admin')
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any)

    const result = await requireAdmin(makeRequest())
    expect(result.forbidden).toBe(false)
  })

  it('returns forbidden=false for service-role key (test bypass)', async () => {
    // Service role key in Authorization header bypasses role check
    const result = await requireAdmin(makeRequest('Bearer service-role-secret'))
    expect(result.user?.id).toBe('service-role')
    expect(result.forbidden).toBe(false)
  })
})
