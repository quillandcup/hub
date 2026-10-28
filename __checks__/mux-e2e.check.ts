import { ApiCheck, AssertionBuilder, Frequency } from 'checkly/constructs'
import { ownerEmailAlert } from './alert-channels'
import { appHost, appUrl, muxCheck } from './config'

// Nightly Mux end-to-end check (docs/MUX_CONFIG.md). It costs nothing and touches no member data:
// the stream checks use one tiny standing test asset in a SEPARATE Mux environment ("checks"),
// with that environment's own signing key; the webhook check sends nothing but an empty body.

// The webhook route is reachable and rejects a request that isn't signed by Mux.
new ApiCheck('mux-webhook-rejects-unsigned', {
  name: `Mux webhook rejects unsigned requests (${appHost})`,
  activated: true,
  frequency: Frequency.EVERY_24H,
  locations: ['us-east-1'],
  alertChannels: [ownerEmailAlert],
  shouldFail: true, // Checkly treats a 4xx as a failure unless told it is expected
  request: {
    method: 'POST',
    url: `${appUrl}/api/webhooks/mux`,
    bodyType: 'JSON',
    body: '{}',
    assertions: [AssertionBuilder.statusCode().equals(401)],
  },
})

// Only declared once the checks environment's values exist (see docs/MUX_CONFIG.md), so deploying
// before they are set is harmless.
if (muxCheck) {
  const streamUrl = `https://stream.mux.com/${muxCheck.playbackId}.m3u8`

  // A signed token minted the way lib/mux.ts does gets the stream manifest.
  new ApiCheck('mux-signed-stream', {
    name: 'Mux signed playback returns a manifest',
    activated: true,
    frequency: Frequency.EVERY_24H,
    locations: ['us-east-1'],
    alertChannels: [ownerEmailAlert],
    environmentVariables: [
      { key: 'MUX_CHECK_SIGNING_KEY_ID', value: muxCheck.signingKeyId },
      { key: 'MUX_CHECK_SIGNING_KEY_PRIVATE', value: muxCheck.signingKeyPrivate, secret: true },
      { key: 'MUX_CHECK_PLAYBACK_ID', value: muxCheck.playbackId },
    ],
    setupScript: { entrypoint: './mux-stream.setup.ts' },
    request: {
      method: 'GET',
      url: streamUrl, // replaced by the setup script, which adds the token
      assertions: [
        AssertionBuilder.statusCode().equals(200),
        AssertionBuilder.textBody().contains('#EXTM3U'),
      ],
    },
  })

  // Without a token the same stream is refused, so the asset really is signed-only.
  new ApiCheck('mux-unsigned-stream-refused', {
    name: 'Mux refuses a signed asset without a token',
    activated: true,
    frequency: Frequency.EVERY_24H,
    locations: ['us-east-1'],
    alertChannels: [ownerEmailAlert],
    shouldFail: true,
    request: {
      method: 'GET',
      url: streamUrl,
      assertions: [AssertionBuilder.statusCode().equals(403)],
    },
  })
}
