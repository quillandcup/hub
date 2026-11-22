import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// We test requireApiPermission by mocking createApiAuth's dependencies.
// The function under test is exported from api-auth.ts.

// Mock the supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { requireApiPermission } from '@/lib/supabase/api-auth'
import { createClient } from '@/lib/supabase/server'

function makeRequest(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (authHeader) headers['authorization'] = authHeader
  return new NextRequest('http://localhost/api/test', { headers })
}

function makeSupabaseMock(user: any, role: string | null, lookupError?: string, mfa: { aal?: string; factors?: unknown[] } = {}) {
  return {
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data: user ? { claims: { sub: user.id, email: user.email, aal: mfa.aal ?? 'aal2' } } : null,
        error: null,
      }),
      getUser: vi.fn().mockResolvedValue({ data: { user: { factors: mfa.factors ?? [] } }, error: null }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      // The roles are read from user_roles as a list (awaited straight after the filter).
      then: (resolve: (v: unknown) => unknown) => resolve({ data: role ? [{ role }] : [], error: lookupError ? { message: lookupError } : null }),
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret'
})

describe('requireApiPermission', () => {
  it('returns forbidden=true when no user session', async () => {
    const mockSupabase = makeSupabaseMock(null, null)
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any)

    const result = await requireApiPermission(makeRequest(), 'system.users.manage')
    expect(result.user).toBeNull()
    expect(result.forbidden).toBe(true)
  })

  it('returns forbidden=true for authenticated member (non-admin)', async () => {
    const mockSupabase = makeSupabaseMock({ id: 'user-1', email: 'a@b.com' }, 'member')
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any)

    const result = await requireApiPermission(makeRequest(), 'system.users.manage')
    expect(result.user).not.toBeNull()
    expect(result.forbidden).toBe(true)
  })

  it.each([
    ['assistant', 'system.users.manage', false],
    ['community_manager', 'system.users.manage', true],
    ['community_manager', 'members.read', false],
    ['conversion_specialist', 'pages.edit', false],
    ['conversion_specialist', 'outreach.manage', false],
    ['conversion_specialist', 'members.read', true],
    ['conversion_specialist', 'member.sudo', true],
    ['conversion_specialist', 'data.export', true],
    ['conversion_specialist', 'changelog.edit', true],
  ] as const)('the role %s asking for %s is forbidden=%s', async (role, permission, forbidden) => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({ id: 'user-1', email: 'a@b.com' }, role) as any)
    expect((await requireApiPermission(makeRequest(), permission)).forbidden).toBe(forbidden)
  })

  it('returns forbidden=false for authenticated admin', async () => {
    const mockSupabase = makeSupabaseMock({ id: 'user-1', email: 'a@b.com' }, 'admin')
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any)

    const result = await requireApiPermission(makeRequest(), 'system.users.manage')
    expect(result.forbidden).toBe(false)
  })

  describe('second sign-in step (src/lib/staff-mfa.ts)', () => {
    const totp = [{ factor_type: 'totp', status: 'verified' }]
    const adminAt = (mfa: { aal?: string; factors?: unknown[] }) =>
      vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({ id: 'user-1', email: 'a@b.com' }, 'admin', undefined, mfa) as any)

    it('is forbidden for an admin with a factor whose session is still aal1', async () => {
      adminAt({ aal: 'aal1', factors: totp })
      expect((await requireApiPermission(makeRequest(), 'system.users.manage')).forbidden).toBe(true)
    })

    it('lets an aal2 admin through', async () => {
      adminAt({ aal: 'aal2', factors: totp })
      expect((await requireApiPermission(makeRequest(), 'system.users.manage')).forbidden).toBe(false)
    })

    it('lets an admin with no factor through while the requirement is off', async () => {
      adminAt({ aal: 'aal1', factors: [] })
      expect((await requireApiPermission(makeRequest(), 'system.users.manage')).forbidden).toBe(false)
    })
  })

  it('is forbidden, not an error, when the role lookup fails even for an admin (unknown is never admin)', async () => {
    const mockSupabase = makeSupabaseMock({ id: 'user-1', email: 'a@b.com' }, 'admin', 'connection lost')
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any)

    const result = await requireApiPermission(makeRequest(), 'system.users.manage')
    expect(result.forbidden).toBe(true)
  })

  it('returns forbidden=false for service-role key (test bypass)', async () => {
    // Service role key in Authorization header bypasses role check
    const result = await requireApiPermission(makeRequest('Bearer service-role-secret'), 'system.users.manage')
    expect(result.user?.id).toBe('service-role')
    expect(result.forbidden).toBe(false)
  })
})
