import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { GET } from '@/app/api/reconcile/slack/route'

vi.mock('@/lib/processing/trigger', () => ({
  triggerSlackSync: vi.fn(),
}))

vi.mock('@/lib/supabase/api-auth', () => ({
  requireAdmin: vi.fn(),
}))

import { triggerSlackSync } from '@/lib/processing/trigger'
import { requireAdmin } from '@/lib/supabase/api-auth'

function makeRequest() {
  return new Request('http://localhost:3000/api/reconcile/slack') as unknown as NextRequest
}

describe('GET /api/reconcile/slack', () => {
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
    it('calls triggerSlackSync with a daysBack window and returns merged result', async () => {
      vi.mocked(triggerSlackSync).mockResolvedValue({
        success: true,
        fetched: { users: 40, channels: 8, messages: 120, reactions: 300 },
        imported: { users: 40, channels: 8, messages: 120, reactions: 300 },
        daysBack: 3,
        importTimestamp: '2026-08-26T00:00:00Z',
        dateRange: { fromDate: '2026-08-23', toDate: '2026-08-26' },
        processing: [{ table: 'slack', success: true }],
      })

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(triggerSlackSync).toHaveBeenCalledWith({ daysBack: 3 })
      expect(body.success).toBe(true)
      expect(body.reconciliation).toBe('slack')
      expect(body.imported.messages).toBe(120)
      expect(body.processing[0].success).toBe(true)
    })
  })

  describe('error handling', () => {
    it('returns 500 and error message when triggerSlackSync throws', async () => {
      vi.mocked(triggerSlackSync).mockRejectedValue(new Error('Slack API unavailable'))

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBe('Slack API unavailable')
    })

    it('returns 500 with fallback message when error has no message', async () => {
      vi.mocked(triggerSlackSync).mockRejectedValue({})

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBe('Failed to reconcile Slack data')
    })
  })
})
