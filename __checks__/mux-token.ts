// Mints a Mux signed-playback token (RS256 JWT) with Node's crypto only, the way
// `mux.jwt.signPlaybackId` in lib/mux.ts does, so the nightly check (mux-e2e.check.ts) needs no
// dependency inside Checkly's runtime. Tested in tests/lib/mux-token.test.ts.

import { createSign } from 'node:crypto'

export type MuxTokenType = 'video' | 'thumbnail' | 'storyboard'

/** Mux's JWT audience for each token type. */
const AUDIENCE: Record<MuxTokenType, string> = { video: 'v', thumbnail: 't', storyboard: 's' }

const b64url = (value: string | Buffer) => Buffer.from(value).toString('base64url')

export function signMuxToken(opts: {
  keyId: string
  /** The private key exactly as Mux shows it: a base64-encoded PEM (MUX_SIGNING_KEY_PRIVATE). */
  privateKeyBase64: string
  playbackId: string
  type: MuxTokenType
  /** Seconds the token stays valid. */
  ttlSeconds: number
  nowMs: number
}): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: opts.keyId }))
  const claims = b64url(
    JSON.stringify({
      sub: opts.playbackId,
      aud: AUDIENCE[opts.type],
      exp: Math.floor(opts.nowMs / 1000) + opts.ttlSeconds,
      kid: opts.keyId,
    }),
  )
  const signature = createSign('RSA-SHA256')
    .update(`${header}.${claims}`)
    .sign(Buffer.from(opts.privateKeyBase64, 'base64').toString('utf8'))
  return `${header}.${claims}.${b64url(signature)}`
}
