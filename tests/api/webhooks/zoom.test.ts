import { describe, it, expect, beforeEach, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import type { NextRequest } from 'next/server'
import { server } from '../../setup-msw'
import { loadWebhookFixture } from '../../helpers/webhook-helpers'
import { POST, GET } from '@/app/api/webhooks/zoom/route'
import { createHmac } from 'crypto'

describe('Zoom Webhook', () => {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'

  beforeEach(() => {
    vi.clearAllMocks()
    // Mock environment variable for tests
    process.env.ZOOM_WEBHOOK_SECRET_TOKEN = 'test-zoom-secret'
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
      const fixture = loadWebhookFixture('zoom', 'meeting-ended.json')
      const body = JSON.stringify(fixture.body)
      const timestamp = fixture.headers['x-zm-request-timestamp']

      // Calculate valid signature
      const message = `v0:${timestamp}:${body}`
      const validSignature = 'v0=' + createHmac('sha256', 'test-zoom-secret')
        .update(message)
        .digest('hex')

      let importTriggered = false
      let importPayload: any = null

      server.use(
        http.post(`${baseUrl}/api/import/zoom`, async ({ request }) => {
          importTriggered = true
          importPayload = await request.json()
          return HttpResponse.json({ success: true, imported: 5 })
        })
      )

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

      // Should return 200 immediately
      expect(response.status).toBe(200)
      expect(responseBody.received).toBe(true)
      expect(responseBody.event).toBe('meeting.ended')
      expect(responseBody.processed).toBe(true)

      // Wait for async import trigger (includes 10s delay + processing)
      await new Promise(resolve => setTimeout(resolve, 10200))

      // Verify import was triggered
      expect(importTriggered).toBe(true)
      expect(importPayload.fromDate).toBe('2026-04-26')
      expect(importPayload.toDate).toBe('2026-04-26')
    }, 15000) // Increase test timeout for 10s delay

    it('should handle meeting events without crashing', async () => {
      const fixture = loadWebhookFixture('zoom', 'meeting-ended.json')
      // Modify to meeting.started event
      fixture.body.event = 'meeting.started'

      const body = JSON.stringify(fixture.body)
      const timestamp = fixture.headers['x-zm-request-timestamp']

      // Calculate valid signature
      const message = `v0:${timestamp}:${body}`
      const validSignature = 'v0=' + createHmac('sha256', 'test-zoom-secret')
        .update(message)
        .digest('hex')

      server.use(
        http.post(`${baseUrl}/api/import/zoom`, () => {
          return HttpResponse.json({ success: true })
        })
      )

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
      expect(responseBody.received).toBe(true)
      expect(responseBody.processed).toBe(true)
    })

    it('should still return 200 on internal errors', async () => {
      const fixture = loadWebhookFixture('zoom', 'meeting-ended.json')
      const body = JSON.stringify(fixture.body)
      const timestamp = fixture.headers['x-zm-request-timestamp']

      // Calculate valid signature
      const message = `v0:${timestamp}:${body}`
      const validSignature = 'v0=' + createHmac('sha256', 'test-zoom-secret')
        .update(message)
        .digest('hex')

      server.use(
        http.post(`${baseUrl}/api/import/zoom`, () => {
          return HttpResponse.json({ error: 'Database error' }, { status: 500 })
        })
      )

      const request = new Request('http://localhost:3000/api/webhooks/zoom', {
        method: 'POST',
        headers: new Headers({
          ...fixture.headers,
          'x-zm-signature': validSignature,
        }),
        body,
      })

      const response = await POST(request as unknown as NextRequest)

      // Should still return 200 to avoid retries
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
