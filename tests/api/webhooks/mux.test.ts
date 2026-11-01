import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { createHmac, generateKeyPairSync } from 'crypto'
import { POST } from '@/app/api/webhooks/mux/route'
import { assetUpdateFromEvent, createMuxClient, signPlaybackTokens } from '@/lib/mux'

const SECRET = 'test-mux-webhook-secret'

// The route updates `videos` with the service-role client: capture the update and answer with
// the rows it "matched".
const select = vi.fn(async () => ({ data: [{ id: 'video-1' }] as { id: string }[] | null, error: null as unknown }))
const eq = vi.fn((_col: string, _val: string) => ({ select }))
const update = vi.fn((_values: Record<string, unknown>) => ({ eq }))
// After an update the route also looks for lessons to give the length to: no video with that asset to read here.
const maybeSingle = vi.fn(async () => ({ data: null, error: null }))
const from = vi.fn((_table: string) => ({ update, select: () => ({ eq: () => ({ maybeSingle }) }) }))
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: () => ({ from }) }))

/** A request signed the way Mux signs it: `t=<unix seconds>,v1=<hmac sha256 of "<t>.<body>">`. */
function signedRequest(body: string, opts: { secret?: string; timestamp?: number } = {}) {
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000)
  const v1 = createHmac('sha256', opts.secret ?? SECRET).update(`${timestamp}.${body}`).digest('hex')
  return new Request('http://localhost:3000/api/webhooks/mux', {
    method: 'POST',
    headers: { 'mux-signature': `t=${timestamp},v1=${v1}` },
    body,
  }) as unknown as NextRequest
}

const readyEvent = {
  type: 'video.asset.ready',
  data: {
    id: 'asset-1',
    status: 'ready',
    duration: 61.5,
    playback_ids: [
      { id: 'public-pb', policy: 'public' },
      { id: 'signed-pb', policy: 'signed' },
    ],
  },
}

describe('Mux webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('MUX_WEBHOOK_SECRET', SECRET)
    select.mockResolvedValue({ data: [{ id: 'video-1' }], error: null })
  })

  it('marks the video ready with its signed playback id and duration', async () => {
    const response = await POST(signedRequest(JSON.stringify(readyEvent)))

    expect(response.status).toBe(200)
    expect(from).toHaveBeenCalledWith('videos')
    expect(update).toHaveBeenCalledWith({ status: 'ready', mux_playback_id: 'signed-pb', duration_seconds: 61.5 })
    expect(eq).toHaveBeenCalledWith('mux_asset_id', 'asset-1')
  })

  it('records a failed asset without touching the playback id', async () => {
    const body = JSON.stringify({ type: 'video.asset.errored', data: { id: 'asset-2' } })
    const response = await POST(signedRequest(body))

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith({ status: 'errored' })
  })

  it('is idempotent: a redelivered event sets the same values', async () => {
    const body = JSON.stringify(readyEvent)
    await POST(signedRequest(body))
    await POST(signedRequest(body))

    expect(update).toHaveBeenCalledTimes(2)
    expect(update.mock.calls[0][0]).toEqual(update.mock.calls[1][0])
  })

  it('acknowledges events it does not track without writing', async () => {
    const body = JSON.stringify({ type: 'video.asset.created', data: { id: 'asset-3' } })
    const response = await POST(signedRequest(body))

    expect(response.status).toBe(200)
    expect((await response.json()).processed).toBe(false)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects a request signed with the wrong secret', async () => {
    const response = await POST(signedRequest(JSON.stringify(readyEvent), { secret: 'someone-else' }))

    expect(response.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects an unsigned request', async () => {
    const request = new Request('http://localhost:3000/api/webhooks/mux', {
      method: 'POST',
      body: JSON.stringify(readyEvent),
    }) as unknown as NextRequest
    const response = await POST(request)

    expect(response.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects a stale timestamp (replay)', async () => {
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600
    const response = await POST(signedRequest(JSON.stringify(readyEvent), { timestamp: tenMinutesAgo }))

    expect(response.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects everything while the secret is unset, even a request signed with an empty one', async () => {
    vi.stubEnv('MUX_WEBHOOK_SECRET', '')
    const response = await POST(signedRequest(JSON.stringify(readyEvent), { secret: '' }))

    expect(response.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  it('answers 500 so Mux retries when the asset has no videos row yet', async () => {
    select.mockResolvedValue({ data: [], error: null })
    const response = await POST(signedRequest(JSON.stringify(readyEvent)))

    expect(response.status).toBe(500)
  })

  it('answers 500 so Mux retries when the update fails', async () => {
    select.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const response = await POST(signedRequest(JSON.stringify(readyEvent)))

    expect(response.status).toBe(500)
  })
})

describe('assetUpdateFromEvent', () => {
  it('leaves the playback id out when the asset has no signed one', () => {
    const update = assetUpdateFromEvent({
      type: 'video.asset.ready',
      data: { id: 'a', playback_ids: [{ id: 'p', policy: 'public' }] },
    })
    expect(update).toEqual({ muxAssetId: 'a', status: 'ready', playbackId: undefined, durationSeconds: undefined })
  })

  it('ignores an event with no asset id', () => {
    expect(assetUpdateFromEvent({ type: 'video.asset.ready', data: {} })).toBeNull()
  })
})

describe('signPlaybackTokens', () => {
  it('returns a token for each of the three types a lesson view needs', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    vi.stubEnv('MUX_SIGNING_KEY_ID', 'test-key-id')
    vi.stubEnv('MUX_SIGNING_KEY_PRIVATE', Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64'))

    const tokens = await signPlaybackTokens(createMuxClient(), 'playback-id')

    for (const token of Object.values(tokens)) expect(token.split('.')).toHaveLength(3)
    const audiences = Object.values(tokens).map(
      (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).aud,
    )
    expect(audiences.sort()).toEqual(['t', 'v', 's'].sort())
  })
})
