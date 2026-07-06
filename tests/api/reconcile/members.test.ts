import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { GET } from '@/app/api/reconcile/members/route'

vi.mock('@/lib/processing/trigger', () => ({
  triggerKajabiSync: vi.fn(),
}))

vi.mock('@/lib/supabase/api-auth', () => ({
  requireAdmin: vi.fn(),
}))

import { triggerKajabiSync } from '@/lib/processing/trigger'
import { requireAdmin } from '@/lib/supabase/api-auth'

function makeRequest() {
  return new Request('http://localhost:3000/api/reconcile/members') as unknown as NextRequest
}

describe('GET /api/reconcile/members', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdmin).mockResolvedValue({
      user: { id: 'service-role' } as any,
      forbidden: false,
      supabase: {} as any,
    })
  })

  describe('auth', () => {
    it('returns 401 when unauthenticated', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ user: null, forbidden: false, supabase: {} as any })

      const response = await GET(makeRequest())

      expect(response.status).toBe(401)
    })

    it('returns 403 when authenticated but not admin', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ user: { id: 'user-1' } as any, forbidden: true, supabase: {} as any })

      const response = await GET(makeRequest())

      expect(response.status).toBe(403)
    })
  })

  describe('success', () => {
    it('calls triggerKajabiSync and returns merged result', async () => {
      vi.mocked(triggerKajabiSync).mockResolvedValue({
        success: true,
        members: {
          contacts: 250,
          customers: 180,
          purchases: 160,
          offers: 12,
          importTimestamp: '2024-01-01T00:00:00Z',
          processing: [{ table: 'members', success: true, processed: 250 }],
        },
      })

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(triggerKajabiSync).toHaveBeenCalledOnce()
      expect(body.success).toBe(true)
      expect(body.reconciliation).toBe('members')
      expect(body.members.contacts).toBe(250)
      expect(body.members.processing[0].processed).toBe(250)
    })
  })

  describe('error handling', () => {
    it('returns 500 and error message when triggerKajabiSync throws', async () => {
      vi.mocked(triggerKajabiSync).mockRejectedValue(new Error('Kajabi API unavailable'))

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBe('Kajabi API unavailable')
    })

    it('returns 500 with fallback message when error has no message', async () => {
      vi.mocked(triggerKajabiSync).mockRejectedValue({})

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBe('Failed to reconcile members')
    })
  })
})
