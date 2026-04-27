import { describe, it, expect, beforeEach, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../setup-msw'
import { loadWebhookFixture } from '../../helpers/webhook-helpers'
import { POST, GET } from '@/app/api/webhooks/calendar/route'

describe('Calendar Webhook', () => {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks()
  })

  describe('GET - Verification', () => {
    it('should respond to verification request', async () => {
      const request = new Request('http://localhost:3000/api/webhooks/calendar', {
        method: 'GET',
      })

      const response = await GET(request)
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

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.received).toBe(true)
    })

    it('should trigger calendar sync on event change', async () => {
      const fixture = loadWebhookFixture('calendar', 'event-changed.json')

      // Mock the internal fetch to /api/sync/calendar
      let syncTriggered = false
      let syncPayload: any = null

      server.use(
        http.post(`${baseUrl}/api/sync/calendar`, async ({ request }) => {
          syncTriggered = true
          syncPayload = await request.json()
          return HttpResponse.json({ success: true })
        })
      )

      const request = new Request('http://localhost:3000/api/webhooks/calendar', {
        method: 'POST',
        headers: new Headers(fixture.headers),
        body: JSON.stringify(fixture.body),
      })

      const response = await POST(request)
      const body = await response.json()

      // Should return 200 immediately
      expect(response.status).toBe(200)
      expect(body.received).toBe(true)
      expect(body.resourceState).toBe('exists')
      expect(body.triggered).toBe('calendar_sync')

      // Give async fetch time to trigger (webhook uses fire-and-forget)
      await new Promise(resolve => setTimeout(resolve, 100))

      // Verify sync was triggered
      expect(syncTriggered).toBe(true)
      expect(syncPayload).toEqual({
        daysBack: 30,
        daysForward: 90,
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

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toContain('Invalid webhook payload')
    })

    it('should still return 200 on internal errors to avoid retries', async () => {
      const fixture = loadWebhookFixture('calendar', 'event-changed.json')

      // Mock fetch to fail
      server.use(
        http.post(`${baseUrl}/api/sync/calendar`, () => {
          return HttpResponse.json({ error: 'Internal error' }, { status: 500 })
        })
      )

      const request = new Request('http://localhost:3000/api/webhooks/calendar', {
        method: 'POST',
        headers: new Headers(fixture.headers),
        body: JSON.stringify(fixture.body),
      })

      const response = await POST(request)

      // Should still return 200 (webhook best practice)
      expect(response.status).toBe(200)
    })

    it('should be idempotent (handle duplicate webhooks)', async () => {
      const fixture = loadWebhookFixture('calendar', 'event-changed.json')

      let syncCallCount = 0
      server.use(
        http.post(`${baseUrl}/api/sync/calendar`, () => {
          syncCallCount++
          return HttpResponse.json({ success: true })
        })
      )

      // Send same webhook twice
      for (let i = 0; i < 2; i++) {
        const request = new Request('http://localhost:3000/api/webhooks/calendar', {
          method: 'POST',
          headers: new Headers(fixture.headers),
          body: JSON.stringify(fixture.body),
        })

        const response = await POST(request)
        expect(response.status).toBe(200)
      }

      await new Promise(resolve => setTimeout(resolve, 200))

      // Both webhooks should trigger sync (Google handles deduplication)
      expect(syncCallCount).toBe(2)
    })
  })

  describe('Security', () => {
    beforeEach(() => {
      // Set token for security tests
      process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN = 'test-token-789'
    })

    it('should verify channel token', async () => {
      const fixture = loadWebhookFixture('calendar', 'event-changed.json')

      server.use(
        http.post(`${baseUrl}/api/sync/calendar`, () => {
          return HttpResponse.json({ success: true })
        })
      )

      // Test with valid token (matches fixture)
      const validRequest = new Request('http://localhost:3000/api/webhooks/calendar', {
        method: 'POST',
        headers: new Headers(fixture.headers),
        body: JSON.stringify(fixture.body),
      })

      const validResponse = await POST(validRequest)
      expect(validResponse.status).toBe(200)

      // Test with invalid token
      const invalidHeaders = { ...fixture.headers }
      invalidHeaders['x-goog-channel-token'] = 'wrong-token'

      const invalidRequest = new Request('http://localhost:3000/api/webhooks/calendar', {
        method: 'POST',
        headers: new Headers(invalidHeaders),
        body: JSON.stringify(fixture.body),
      })

      const invalidResponse = await POST(invalidRequest)
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

      const response = await POST(request)
      expect(response.status).toBe(200)

      // Restore env var
      if (original) process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN = original
    })
  })
})
