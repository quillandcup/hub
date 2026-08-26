import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import { loadWebhookFixture } from '../../helpers/webhook-helpers'

// Regression test for the bug where processSlackEvent's Bronze upsert failed
// silently (wrong column name) but the webhook logged success and still
// triggered Silver reprocessing anyway. Mock the Supabase client the webhook
// constructs internally so the upsert can be forced to fail.
const upsertMock = vi.fn(() => Promise.resolve({ data: null, error: { message: 'simulated failure' } }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    schema: () => ({
      from: () => ({
        upsert: upsertMock,
      }),
    }),
  })),
}))

vi.mock('@/lib/processing/trigger', () => ({
  triggerReprocessing: vi.fn(() => Promise.resolve({ processed: [] })),
}))

import { POST } from '@/app/api/webhooks/slack/route'
import { triggerReprocessing } from '@/lib/processing/trigger'

describe('Slack webhook - Bronze write failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.SLACK_SIGNING_SECRET
  })

  it('does not trigger Silver reprocessing when the Bronze message upsert fails', async () => {
    const fixture = loadWebhookFixture('slack', 'message-posted.json')
    const request = new Request('http://localhost:3000/api/webhooks/slack', {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(fixture.body),
    })

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await POST(request as unknown as NextRequest)

    // Still ack the webhook so Slack doesn't retry-storm us.
    expect(response.status).toBe(200)

    expect(upsertMock).toHaveBeenCalled()
    expect(triggerReprocessing).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error upserting Slack message:',
      expect.objectContaining({ message: 'simulated failure' })
    )

    consoleErrorSpy.mockRestore()
  })

  it('does not trigger Silver reprocessing when the Bronze reaction upsert fails', async () => {
    const fixture = loadWebhookFixture('slack', 'reaction-added.json')
    const request = new Request('http://localhost:3000/api/webhooks/slack', {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(fixture.body),
    })

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await POST(request as unknown as NextRequest)

    expect(response.status).toBe(200)
    expect(upsertMock).toHaveBeenCalled()
    expect(triggerReprocessing).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error upserting Slack reaction:',
      expect.objectContaining({ message: 'simulated failure' })
    )

    consoleErrorSpy.mockRestore()
  })
})
