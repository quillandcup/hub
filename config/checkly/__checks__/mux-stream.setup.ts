// Setup script of the Mux stream check (mux-e2e.check.ts): runs inside Checkly just before the
// request and points it at the test asset's manifest with a freshly signed token. The three MUX_CHECK_* values
// come from the check's environment variables.
import { signMuxToken } from './mux-token'

declare const request: { url: string }

const token = signMuxToken({
  keyId: process.env.MUX_CHECK_SIGNING_KEY_ID as string,
  privateKeyBase64: process.env.MUX_CHECK_SIGNING_KEY_PRIVATE as string,
  playbackId: process.env.MUX_CHECK_PLAYBACK_ID as string,
  type: 'video',
  ttlSeconds: 300,
  nowMs: Date.now(),
})
request.url = `https://stream.mux.com/${process.env.MUX_CHECK_PLAYBACK_ID}.m3u8?token=${token}`
