import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { loadWebhookFixture } from '../../helpers/webhook-helpers'
import { POST, GET } from '@/app/api/webhooks/zoom/route'
import { createHmac } from 'crypto'

// The route wraps its delayed fire-and-forget trigger in next/server's after()
// so Vercel keeps the function alive until it finishes. Tests call the handler
// directly (no real Next.js request scope), where after() throws "called
// outside a request scope" — so run the callback the same way Vercel would
// post-response. The callback's own setTimeout is still subject to fake timers.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (callback: () => void | Promise<void>) => {
      void callback()
    },
  }
})

// Mock trigger module — webhook calls triggerZoomImport() directly (no HTTP)
vi.mock('@/lib/processing/trigger', () => ({
  triggerCalendarSync: vi.fn(() => Promise.resolve({ success: true })),
  triggerZoomImport: vi.fn(() => Promise.resolve({ success: true, imported: 5 })),
  triggerReprocessing: vi.fn(() => Promise.resolve({ processed: [] })),
}))

import { triggerZoomImport } from '@/lib/processing/trigger'

describe('Zoom Webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ZOOM_WEBHOOK_SECRET_TOKEN = 'test-zoom-secret'
    vi.mocked(triggerZoomImport).mockResolvedValue({ success: true, imported: 5 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('GET - Verification', () => {
    it('should respond to verification request', async () => {
      const request = new Request('http://localhost:3000/api/webhooks/zoom', {
        method: 'GET',
      })

      const response = await GET(request as unknown as NextRequest)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.verified).toBe(true)
      expect(body.message).toContain('Zoom webhook endpoint ready')
    })
  })

  describe('POST - Webhook Events', () => {
    it('should handle endpoint validation challenge', async () => {
      const fixture = loadWebhookFixture('zoom', 'endpoint-validation.json')
      const body = JSON.stringify(fixture.body)
      const timestamp = fixture.headers['x-zm-request-timestamp']

      // Calculate valid signature
      const message = `v0:${timestamp}:${body}`
      const validSignature = 'v0=' + createHmac('sha256', 'test-zoom-secret')
        .update(message)
        .digest('hex')

      const request = new Request('http://localhost:3000/api/webhooks/zoom', {
        method: 'POST',
        headers: new Headers({
          ...fixture.headers,
          'x-zm-signature': validSignature,
        }),
        body,
      })

      const response = await POST(request as unknown as NextRequest)
      const responseBody = await response.json()

      expect(response.status).toBe(200)
      expect(responseBody.plainToken).toBe('test-plain-token-123')
      expect(responseBody.encryptedToken).toBeDefined()

      // Verify encrypted token is HMAC of plain token
      const expectedToken = createHmac('sha256', 'test-zoom-secret')
        .update('test-plain-token-123')
        .digest('hex')
      expect(responseBody.encryptedToken).toBe(expectedToken)
    })

    it('should trigger Zoom import when meeting ends', async () => {
      vi.useFakeTimers()

      const fixture = loadWebhookFixture('zoom', 'meeting-ended.json')
      const body = JSON.stringify(fixture.body)
      const timestamp = fixture.headers['x-zm-request-timestamp']

      const message = `v0:${timestamp}:${body}`
      const validSignature = 'v0=' + createHmac('sha256', 'test-zoom-secret')
        .update(message)
        .digest('hex')

      const request = new Request('http://localhost:3000/api/webhooks/zoom', {
        method: 'POST',
        headers: new Headers({ ...fixture.headers, 'x-zm-signature': validSignature }),
        body,
      })

      const response = await POST(request as unknown as NextRequest)
      const responseBody = await response.json()

      expect(response.status).toBe(200)
      expect(responseBody.received).toBe(true)
      expect(responseBody.event).toBe('meeting.ended')
      expect(responseBody.processed).toBe(true)

      // Fast-forward past the 10s delay and flush async work
      await vi.runAllTimersAsync()

      expect(triggerZoomImport).toHaveBeenCalledOnce()
      expect(triggerZoomImport).toHaveBeenCalledWith({
        fromDate: '2026-04-26',
        toDate: '2026-04-26',
      })
    })

    it('should handle meeting events without crashing', async () => {
      const fixture = loadWebhookFixture('zoom', 'meeting-ended.json')
      // Modify to meeting.started event (should not trigger import)
      fixture.body.event = 'meeting.started'

      const body = JSON.stringify(fixture.body)
      const timestamp = fixture.headers['x-zm-request-timestamp']

      const message = `v0:${timestamp}:${body}`
      const validSignature = 'v0=' + createHmac('sha256', 'test-zoom-secret')
        .update(message)
        .digest('hex')

      const request = new Request('http://localhost:3000/api/webhooks/zoom', {
        method: 'POST',
        headers: new Headers({ ...fixture.headers, 'x-zm-signature': validSignature }),
        body,
      })

      const response = await POST(request as unknown as NextRequest)
      const responseBody = await response.json()

      expect(response.status).toBe(200)
      expect(responseBody.received).toBe(true)
      expect(responseBody.processed).toBe(true)
    })

    it('should still return 200 on internal errors', async () => {
      vi.useFakeTimers()
      vi.mocked(triggerZoomImport).mockRejectedValue(new Error('Database error'))

      const fixture = loadWebhookFixture('zoom', 'meeting-ended.json')
      const body = JSON.stringify(fixture.body)
      const timestamp = fixture.headers['x-zm-request-timestamp']

      const message = `v0:${timestamp}:${body}`
      const validSignature = 'v0=' + createHmac('sha256', 'test-zoom-secret')
        .update(message)
        .digest('hex')

      const request = new Request('http://localhost:3000/api/webhooks/zoom', {
        method: 'POST',
        headers: new Headers({ ...fixture.headers, 'x-zm-signature': validSignature }),
        body,
      })

      const response = await POST(request as unknown as NextRequest)

      // Should still return 200 to avoid retries (error happens async after response)
      expect(response.status).toBe(200)
    })

    it('should handle malformed JSON payload', async () => {
      const request = new Request('http://localhost:3000/api/webhooks/zoom', {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-zm-signature': 'v0=test',
          'x-zm-request-timestamp': '1234567890',
        }),
        body: 'invalid-json',
      })

      const response = await POST(request as unknown as NextRequest)
      const body = await response.json()

      // Should return 200 with error message
      expect(response.status).toBe(200)
      expect(body.received).toBe(true)
      expect(body.error).toBeDefined()
    })
  })

  describe('Security', () => {
    it('should verify HMAC signature', async () => {
      const fixture = loadWebhookFixture('zoom', 'meeting-ended.json')
      const body = JSON.stringify(fixture.body)
      const timestamp = fixture.headers['x-zm-request-timestamp']

      // Calculate valid signature
      const message = `v0:${timestamp}:${body}`
      const validSignature = 'v0=' + createHmac('sha256', 'test-zoom-secret')
        .update(message)
        .digest('hex')

      // Test with valid signature
      const validRequest = new Request('http://localhost:3000/api/webhooks/zoom', {
        method: 'POST',
        headers: new Headers({
          ...fixture.headers,
          'x-zm-signature': validSignature,
        }),
        body,
      })

      const validResponse = await POST(validRequest as unknown as NextRequest)
      expect(validResponse.status).toBe(200)

      // Test with invalid signature
      const invalidRequest = new Request('http://localhost:3000/api/webhooks/zoom', {
        method: 'POST',
        headers: new Headers({
          ...fixture.headers,
          'x-zm-signature': 'v0=invalid-signature',
        }),
        body,
      })

      const invalidResponse = await POST(invalidRequest as unknown as NextRequest)
      expect(invalidResponse.status).toBe(401)

      const errorBody = await invalidResponse.json()
      expect(errorBody.error).toBe('Invalid signature')
    })

    it('should allow requests when no secret is configured', async () => {
      // Save original env var
      const original = process.env.ZOOM_WEBHOOK_SECRET_TOKEN
      delete process.env.ZOOM_WEBHOOK_SECRET_TOKEN

      const fixture = loadWebhookFixture('zoom', 'meeting-ended.json')

      const request = new Request('http://localhost:3000/api/webhooks/zoom', {
        method: 'POST',
        headers: new Headers(fixture.headers),
        body: JSON.stringify(fixture.body),
      })

      const response = await POST(request as unknown as NextRequest)
      expect(response.status).toBe(200)

      // Restore env var
      if (original) process.env.ZOOM_WEBHOOK_SECRET_TOKEN = original
    })
  })
})
