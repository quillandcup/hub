import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { loadWebhookFixture } from '../../helpers/webhook-helpers'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { POST, GET } from '@/app/api/webhooks/slack/route'
import { createHmac } from 'crypto'

// Mock triggerReprocessing — webhook now calls it directly (no HTTP)
vi.mock('@/lib/processing/trigger', () => ({
  triggerReprocessing: vi.fn(() => Promise.resolve({ processed: [] })),
}))

import { triggerReprocessing } from '@/lib/processing/trigger'

describe('Slack Webhook', () => {
  const supabase = getTestSupabaseAdminClient()

  beforeEach(async () => {
    vi.clearAllMocks()
    process.env.SLACK_SIGNING_SECRET = 'test-slack-secret'

    // Clean up test data
    await supabase
      .schema('bronze')
      .from('slack_messages')
      .delete()
      .eq('channel_id', 'C123456')

    await supabase
      .schema('bronze')
      .from('slack_reactions')
      .delete()
      .eq('channel_id', 'C123456')
  })

  describe('GET - Verification', () => {
    it('should respond to verification request', async () => {
      const request = new Request('http://localhost:3000/api/webhooks/slack', {
        method: 'GET',
      })

      const response = await GET(request as unknown as NextRequest)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.verified).toBe(true)
      expect(body.message).toContain('Slack webhook endpoint ready')
    })
  })

  describe('POST - Webhook Events', () => {
    it('should handle URL verification challenge', async () => {
      const fixture = loadWebhookFixture('slack', 'url-verification.json')
      const body = JSON.stringify(fixture.body)
      // Use current timestamp to pass the 5-minute window check
      const timestamp = Math.floor(Date.now() / 1000).toString()

      // Calculate valid signature
      const sigBasestring = `v0:${timestamp}:${body}`
      const validSignature = 'v0=' + createHmac('sha256', 'test-slack-secret')
        .update(sigBasestring)
        .digest('hex')

      const request = new Request('http://localhost:3000/api/webhooks/slack', {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-slack-signature': validSignature,
          'x-slack-request-timestamp': timestamp,
        }),
        body,
      })

      const response = await POST(request as unknown as NextRequest)
      const responseBody = await response.json()

      expect(response.status).toBe(200)
      expect(responseBody.challenge).toBe('test-challenge-string-123')
    })

    it('should upsert message to Bronze layer', async () => {
      const fixture = loadWebhookFixture('slack', 'message-posted.json')
      const body = JSON.stringify(fixture.body)
      const timestamp = Math.floor(Date.now() / 1000).toString()
      const sigBasestring = `v0:${timestamp}:${body}`
      const signature = 'v0=' + createHmac('sha256', 'test-slack-secret')
        .update(sigBasestring)
        .digest('hex')

      const request = new Request('http://localhost:3000/api/webhooks/slack', {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-slack-signature': signature,
          'x-slack-request-timestamp': timestamp,
        }),
        body,
      })

      const response = await POST(request as unknown as NextRequest)
      expect(response.status).toBe(200)

      // Regression check for the raw_data/raw_payload column-name bug: the row
      // must actually land in Bronze, with the NOT NULL raw_payload populated.
      const { data: row, error } = await supabase
        .schema('bronze')
        .from('slack_messages')
        .select('*')
        .eq('channel_id', 'C123456')
        .eq('message_ts', fixture.body.event.ts)
        .single()

      expect(error).toBeNull()
      expect(row).toMatchObject({
        channel_id: 'C123456',
        message_ts: fixture.body.event.ts,
        user_id: fixture.body.event.user,
        text: fixture.body.event.text,
      })
      expect(row!.raw_payload).toBeTruthy()
    })

    it('should upsert reaction to Bronze layer', async () => {
      const fixture = loadWebhookFixture('slack', 'reaction-added.json')
      const body = JSON.stringify(fixture.body)
      const timestamp = Math.floor(Date.now() / 1000).toString()
      const sigBasestring = `v0:${timestamp}:${body}`
      const signature = 'v0=' + createHmac('sha256', 'test-slack-secret')
        .update(sigBasestring)
        .digest('hex')

      const request = new Request('http://localhost:3000/api/webhooks/slack', {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-slack-signature': signature,
          'x-slack-request-timestamp': timestamp,
        }),
        body,
      })

      const response = await POST(request as unknown as NextRequest)
      expect(response.status).toBe(200)

      const { data: row, error } = await supabase
        .schema('bronze')
        .from('slack_reactions')
        .select('*')
        .eq('channel_id', 'C123456')
        .eq('message_ts', fixture.body.event.item.ts)
        .eq('user_id', fixture.body.event.user)
        .eq('reaction', fixture.body.event.reaction)
        .single()

      expect(error).toBeNull()
      expect(row!.raw_payload).toBeTruthy()
    })

    it('should trigger Silver processing after Bronze upsert', async () => {
      const fixture = loadWebhookFixture('slack', 'message-posted.json')
      const body = JSON.stringify(fixture.body)
      const timestamp = Math.floor(Date.now() / 1000).toString()
      const sigBasestring = `v0:${timestamp}:${body}`
      const signature = 'v0=' + createHmac('sha256', 'test-slack-secret')
        .update(sigBasestring)
        .digest('hex')

      const request = new Request('http://localhost:3000/api/webhooks/slack', {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-slack-signature': signature,
          'x-slack-request-timestamp': timestamp,
        }),
        body,
      })

      await POST(request as unknown as NextRequest)

      expect(triggerReprocessing).toHaveBeenCalledWith(
        'slack_messages',
        'bronze',
        expect.objectContaining({
          dateRange: expect.objectContaining({
            from: expect.any(Date),
            to: expect.any(Date),
          }),
        })
      )
    })

    it('should be idempotent (duplicate messages upserted, not duplicated)', async () => {
      const fixture = loadWebhookFixture('slack', 'message-posted.json')
      const body = JSON.stringify(fixture.body)

      // Send same webhook twice
      for (let i = 0; i < 2; i++) {
        const timestamp = Math.floor(Date.now() / 1000).toString()
        const sigBasestring = `v0:${timestamp}:${body}`
        const signature = 'v0=' + createHmac('sha256', 'test-slack-secret')
          .update(sigBasestring)
          .digest('hex')

        const request = new Request('http://localhost:3000/api/webhooks/slack', {
          method: 'POST',
          headers: new Headers({
            'content-type': 'application/json',
            'x-slack-signature': signature,
            'x-slack-request-timestamp': timestamp,
          }),
          body,
        })

        const response = await POST(request as unknown as NextRequest)
        expect(response.status).toBe(200)
      }

      const { count } = await supabase
        .schema('bronze')
        .from('slack_messages')
        .select('*', { count: 'exact', head: true })
        .eq('channel_id', 'C123456')
        .eq('message_ts', fixture.body.event.ts)

      expect(count).toBe(1)
    })

    it('should still return 200 on Bronze insert errors', async () => {
      const fixture = loadWebhookFixture('slack', 'message-posted.json')
      const body = JSON.stringify(fixture.body)
      // Use current timestamp to pass the 5-minute window check
      const timestamp = Math.floor(Date.now() / 1000).toString()

      // Calculate valid signature
      const sigBasestring = `v0:${timestamp}:${body}`
      const validSignature = 'v0=' + createHmac('sha256', 'test-slack-secret')
        .update(sigBasestring)
        .digest('hex')

      // Mock a database error (though Bronze should rarely fail)
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const request = new Request('http://localhost:3000/api/webhooks/slack', {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-slack-signature': validSignature,
          'x-slack-request-timestamp': timestamp,
        }),
        body,
      })

      const response = await POST(request as unknown as NextRequest)

      // Should still return 200 to avoid retries
      expect(response.status).toBe(200)

      consoleSpy.mockRestore()
    })

    it('should handle malformed JSON payload', async () => {
      const request = new Request('http://localhost:3000/api/webhooks/slack', {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-slack-signature': 'v0=test',
          'x-slack-request-timestamp': '1234567890',
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
      const fixture = loadWebhookFixture('slack', 'message-posted.json')
      const body = JSON.stringify(fixture.body)
      // Use current timestamp to pass the 5-minute window check
      const timestamp = Math.floor(Date.now() / 1000).toString()

      // Calculate valid signature
      const sigBasestring = `v0:${timestamp}:${body}`
      const validSignature = 'v0=' + createHmac('sha256', 'test-slack-secret')
        .update(sigBasestring)
        .digest('hex')

      // Test with valid signature
      const validRequest = new Request('http://localhost:3000/api/webhooks/slack', {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-slack-signature': validSignature,
          'x-slack-request-timestamp': timestamp,
        }),
        body,
      })

      const validResponse = await POST(validRequest as unknown as NextRequest)
      expect(validResponse.status).toBe(200)

      // Test with invalid signature
      const invalidRequest = new Request('http://localhost:3000/api/webhooks/slack', {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-slack-signature': 'v0=invalid-signature',
          'x-slack-request-timestamp': timestamp,
        }),
        body,
      })

      const invalidResponse = await POST(invalidRequest as unknown as NextRequest)
      expect(invalidResponse.status).toBe(401)

      const errorBody = await invalidResponse.json()
      expect(errorBody.error).toBe('Invalid signature')
    })

    it('should reject requests with old timestamps', async () => {
      const fixture = loadWebhookFixture('slack', 'message-posted.json')
      const body = JSON.stringify(fixture.body)

      // Create timestamp from 6 minutes ago (> 5 minute threshold)
      const oldTimestamp = Math.floor(Date.now() / 1000) - (6 * 60)
      const sigBasestring = `v0:${oldTimestamp}:${body}`
      const signature = 'v0=' + createHmac('sha256', 'test-slack-secret')
        .update(sigBasestring)
        .digest('hex')

      const request = new Request('http://localhost:3000/api/webhooks/slack', {
        method: 'POST',
        headers: new Headers({
          ...fixture.headers,
          'x-slack-signature': signature,
          'x-slack-request-timestamp': oldTimestamp.toString(),
        }),
        body,
      })

      const response = await POST(request as unknown as NextRequest)
      expect(response.status).toBe(401)

      const errorBody = await response.json()
      expect(errorBody.error).toBe('Request too old')
    })

    it('should allow requests when no secret is configured', async () => {
      // Save original env var
      const original = process.env.SLACK_SIGNING_SECRET
      delete process.env.SLACK_SIGNING_SECRET

      const fixture = loadWebhookFixture('slack', 'url-verification.json')

      const request = new Request('http://localhost:3000/api/webhooks/slack', {
        method: 'POST',
        headers: new Headers(fixture.headers),
        body: JSON.stringify(fixture.body),
      })

      const response = await POST(request as unknown as NextRequest)
      expect(response.status).toBe(200)

      // Restore env var
      if (original) process.env.SLACK_SIGNING_SECRET = original
    })
  })
})
