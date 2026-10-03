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

// Participant events are recorded with the service-role client; capture the upserts.
const upsert = vi.fn(async (..._args: unknown[]) => ({ error: null }))
const schemaFrom = vi.fn((_table: string) => ({ upsert }))
vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => ({ schema: () => ({ from: schemaFrom }) }),
}))

/** A request signed the way Zoom signs it, with the test secret. */
function signedRequest(body: string, timestamp = '1234567890') {
  const signature = 'v0=' + createHmac('sha256', 'test-zoom-secret').update(`v0:${timestamp}:${body}`).digest('hex')
  return new Request('http://localhost:3000/api/webhooks/zoom', {
    method: 'POST',
    headers: new Headers({ 'x-zm-signature': signature, 'x-zm-request-timestamp': timestamp }),
    body,
  }) as unknown as NextRequest
}

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
      const response = await POST(signedRequest('invalid-json'))
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

    it('should reject an unsigned request', async () => {
      const fixture = loadWebhookFixture('zoom', 'meeting-ended.json')
      const request = new Request('http://localhost:3000/api/webhooks/zoom', {
        method: 'POST',
        headers: new Headers({ 'x-zm-request-timestamp': '1234567890' }),
        body: JSON.stringify(fixture.body),
      })

      const response = await POST(request as unknown as NextRequest)
      expect(response.status).toBe(401)
      expect(triggerZoomImport).not.toHaveBeenCalled()
    })

    it('should reject every request when no secret is configured', async () => {
      const original = process.env.ZOOM_WEBHOOK_SECRET_TOKEN
      delete process.env.ZOOM_WEBHOOK_SECRET_TOKEN
      try {
        const fixture = loadWebhookFixture('zoom', 'meeting-ended.json')
        const response = await POST(signedRequest(JSON.stringify(fixture.body)))
        expect(response.status).toBe(401)
      } finally {
        if (original) process.env.ZOOM_WEBHOOK_SECRET_TOKEN = original
      }
    })
  })

  describe('Live presence', () => {
    const participantEvent = (event: string, participant: Record<string, unknown>) =>
      JSON.stringify({
        event,
        event_ts: 1791198000000,
        payload: { object: { id: 123456789, uuid: 'meeting-uuid-1', topic: 'Writing', start_time: '2026-10-05T10:55:00Z', participant } },
      })

    it('records a participant joining', async () => {
      const response = await POST(
        signedRequest(
          participantEvent('meeting.participant_joined', {
            participant_uuid: 'device-1',
            user_id: '16778240',
            user_name: 'Test Writer',
            email: 'writer@example.test',
            join_time: '2026-10-05T11:02:00Z',
          })
        )
      )

      expect(response.status).toBe(200)
      expect(schemaFrom).toHaveBeenCalledWith('zoom_participant_events')
      expect(upsert.mock.calls[0][0]).toMatchObject({
        meeting_uuid: 'meeting-uuid-1',
        meeting_id: '123456789',
        event: 'joined',
        participant_key: 'device-1',
        participant_name: 'Test Writer',
        participant_email: 'writer@example.test',
        event_time: '2026-10-05T11:02:00.000Z',
      })
      expect(upsert.mock.calls[0][1]).toEqual({
        onConflict: 'meeting_uuid,participant_key,event,event_time',
        ignoreDuplicates: true,
      })
    })

    it('records a participant leaving, and still starts the attendance import', async () => {
      vi.useFakeTimers()
      await POST(
        signedRequest(
          participantEvent('meeting.participant_left', {
            user_id: '16778240',
            user_name: 'Test Writer',
            leave_time: '2026-10-05T11:40:00Z',
            leave_reason: 'left the meeting',
          })
        )
      )

      expect(upsert.mock.calls[0][0]).toMatchObject({
        event: 'left',
        participant_key: '16778240',
        participant_email: null,
        event_time: '2026-10-05T11:40:00.000Z',
        leave_reason: 'left the meeting',
      })
      await vi.runAllTimersAsync()
      expect(triggerZoomImport).toHaveBeenCalledOnce()
    })

    it('records nothing for other meeting events', async () => {
      const fixture = loadWebhookFixture('zoom', 'meeting-ended.json')
      vi.useFakeTimers()
      await POST(signedRequest(JSON.stringify(fixture.body)))
      expect(upsert).not.toHaveBeenCalled()
    })
  })
})
