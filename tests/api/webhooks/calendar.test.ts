import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { loadWebhookFixture } from '../../helpers/webhook-helpers'
import { POST, GET } from '@/app/api/webhooks/calendar/route'

// The route wraps its fire-and-forget trigger in next/server's after() so Vercel
// keeps the function alive until it finishes. Tests call the handler directly
// (no real Next.js request scope), where after() throws "called outside a
// request scope" — so run the callback the same way Vercel would post-response.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (callback: () => void | Promise<void>) => {
      void callback()
    },
  }
})

// Mock trigger module — webhook calls triggerCalendarSync() directly (no HTTP)
vi.mock('@/lib/processing/trigger', () => ({
  triggerCalendarSync: vi.fn(() => Promise.resolve({ success: true })),
  triggerZoomImport: vi.fn(() => Promise.resolve({ success: true })),
  triggerReprocessing: vi.fn(() => Promise.resolve({ processed: [] })),
}))

import { triggerCalendarSync } from '@/lib/processing/trigger'

describe('Calendar Webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(triggerCalendarSync).mockResolvedValue({ success: true })
  })

  describe('GET - Verification', () => {
    it('should respond to verification request', async () => {
      const request = new Request('http://localhost:3000/api/webhooks/calendar', {
        method: 'GET',
      })

      const response = await GET(request as unknown as NextRequest)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.verified).toBe(true)
      expect(body.message).toContain('Calendar webhook endpoint ready')
    })
  })

  describe('POST - Webhook Events', () => {
    it('should acknowledge sync notification without processing', async () => {
      const fixture = loadWebhookFixture('calendar', 'sync-notification.json')

      const request = new Request('http://localhost:3000/api/webhooks/calendar', {
        method: 'POST',
        headers: new Headers(fixture.headers),
        body: JSON.stringify(fixture.body),
      })

      const response = await POST(request as unknown as NextRequest)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.received).toBe(true)
    })

    it('should trigger calendar sync on event change', async () => {
      const fixture = loadWebhookFixture('calendar', 'event-changed.json')

      const request = new Request('http://localhost:3000/api/webhooks/calendar', {
        method: 'POST',
        headers: new Headers(fixture.headers),
        body: JSON.stringify(fixture.body),
      })

      const response = await POST(request as unknown as NextRequest)
      const body = await response.json()

      // Should return 200 immediately
      expect(response.status).toBe(200)
      expect(body.received).toBe(true)
      expect(body.resourceState).toBe('exists')
      expect(body.triggered).toBe('calendar_sync')

      // Wait for the fire-and-forget trigger to run
      await vi.waitFor(() => {
        expect(triggerCalendarSync).toHaveBeenCalledOnce()
      }, { timeout: 1000 })

      expect(triggerCalendarSync).toHaveBeenCalledWith({ daysBack: 30, daysForward: 90 })
    })

    describe('channel token', () => {
      const TOKEN = 'channel-token-from-env'
      const send = (token?: string) =>
        POST(
          new Request('http://localhost:3000/api/webhooks/calendar', {
            method: 'POST',
            headers: new Headers({
              'x-goog-channel-id': 'hedgie-hub',
              'x-goog-resource-state': 'exists',
              'x-goog-resource-id': 'resource-1',
              ...(token ? { 'x-goog-channel-token': token } : {}),
            }),
            body: JSON.stringify({}),
          }) as unknown as NextRequest
        )

      afterEach(() => {
        vi.unstubAllEnvs()
      })

      it('accepts the token the channel was created with', async () => {
        vi.stubEnv('GOOGLE_CALENDAR_WEBHOOK_TOKEN', TOKEN)
        expect((await send(TOKEN)).status).toBe(200)
      })

      it.each([['a wrong token', 'not-the-token'], ['no token header', undefined]])(
        'rejects %s and triggers nothing',
        async (_label, token) => {
          vi.stubEnv('GOOGLE_CALENDAR_WEBHOOK_TOKEN', TOKEN)
          expect((await send(token)).status).toBe(401)
          expect(triggerCalendarSync).not.toHaveBeenCalled()
        }
      )

      it('rejects every request on a deployed build while the token is unset', async () => {
        vi.stubEnv('NODE_ENV', 'production')
        vi.stubEnv('GOOGLE_CALENDAR_WEBHOOK_TOKEN', '')
        const response = await send('anything')
        expect(response.status).toBe(401)
        expect((await response.json()).error).toBe('Webhook not configured')
        expect(triggerCalendarSync).not.toHaveBeenCalled()
      })

      it('skips the check locally when the token is unset', async () => {
        vi.stubEnv('GOOGLE_CALENDAR_WEBHOOK_TOKEN', '')
        expect((await send()).status).toBe(200)
      })
    })

    it('should reject invalid webhook payload (missing headers)', async () => {
      const request = new Request('http://localhost:3000/api/webhooks/calendar', {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
        }),
        body: JSON.stringify({}),
      })

      const response = await POST(request as unknown as NextRequest)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toContain('Invalid webhook payload')
    })

    it('should still return 200 on internal errors to avoid retries', async () => {
      const fixture = loadWebhookFixture('calendar', 'event-changed.json')

      vi.mocked(triggerCalendarSync).mockRejectedValue(new Error('Internal error'))

      const request = new Request('http://localhost:3000/api/webhooks/calendar', {
        method: 'POST',
        headers: new Headers(fixture.headers),
        body: JSON.stringify(fixture.body),
      })

      const response = await POST(request as unknown as NextRequest)

      // Should still return 200 (webhook best practice)
      expect(response.status).toBe(200)
    })

    it('should be idempotent (handle duplicate webhooks)', async () => {
      const fixture = loadWebhookFixture('calendar', 'event-changed.json')

      // Send same webhook twice
      for (let i = 0; i < 2; i++) {
        const request = new Request('http://localhost:3000/api/webhooks/calendar', {
          method: 'POST',
          headers: new Headers(fixture.headers),
          body: JSON.stringify(fixture.body),
        })

        const response = await POST(request as unknown as NextRequest)
        expect(response.status).toBe(200)
      }

      // Wait for both fire-and-forget triggers to run
      await vi.waitFor(() => {
        expect(triggerCalendarSync).toHaveBeenCalledTimes(2)
      }, { timeout: 1000 })
    })
  })

  describe('Security', () => {
    beforeEach(() => {
      // Set token for security tests
      process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN = 'test-token-789'
    })

    it('should verify channel token', async () => {
      const fixture = loadWebhookFixture('calendar', 'event-changed.json')

      // Test with valid token (matches fixture)
      const validRequest = new Request('http://localhost:3000/api/webhooks/calendar', {
        method: 'POST',
        headers: new Headers(fixture.headers),
        body: JSON.stringify(fixture.body),
      })

      const validResponse = await POST(validRequest as unknown as NextRequest)
      expect(validResponse.status).toBe(200)

      // Test with invalid token
      const invalidHeaders = { ...fixture.headers }
      invalidHeaders['x-goog-channel-token'] = 'wrong-token'

      const invalidRequest = new Request('http://localhost:3000/api/webhooks/calendar', {
        method: 'POST',
        headers: new Headers(invalidHeaders),
        body: JSON.stringify(fixture.body),
      })

      const invalidResponse = await POST(invalidRequest as unknown as NextRequest)
      expect(invalidResponse.status).toBe(401)

      const errorBody = await invalidResponse.json()
      expect(errorBody.error).toBe('Invalid token')
    })

    it('should allow requests when no token is configured', async () => {
      // Save original env var
      const original = process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN
      delete process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN

      const fixture = loadWebhookFixture('calendar', 'sync-notification.json')

      const request = new Request('http://localhost:3000/api/webhooks/calendar', {
        method: 'POST',
        headers: new Headers(fixture.headers),
        body: JSON.stringify(fixture.body),
      })

      const response = await POST(request as unknown as NextRequest)
      expect(response.status).toBe(200)

      // Restore env var
      if (original) process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN = original
    })
  })
})
