// Config for the checks: shared settings from config/app.ts, per-environment ones from env vars
// (config/env-vars.ts; CI passes them from GitHub Actions variables).
import appConfig from '../../app'

/** The deployment the monitors watch, e.g. https://hub.quillandcup.com (no trailing slash). */
export const appUrl = appConfig.appUrl.replace(/\/+$/, '')
export const appHost = new URL(appUrl).host

/** The Slack channel (name) the monitors alert, alongside the email. */
export const alertsSlackChannel = appConfig.slack.alertsChannelName

/** The monitors watch production, so they alert production's ALERTS_EMAIL. */
const alertsEmail = process.env.ALERTS_EMAIL
if (!alertsEmail) throw new Error('ALERTS_EMAIL is not set -- see config/env-vars.ts')
export const alertEmail: string = alertsEmail

/**
 * The Mux end-to-end check's test asset, in a separate Mux environment (docs/infrastructure/MUX_CONFIG.md).
 * Null until all three values are set, so the check is simply not declared before then.
 */
const muxKeyId = process.env.MUX_CHECK_SIGNING_KEY_ID
const muxKeyPrivate = process.env.MUX_CHECK_SIGNING_KEY_PRIVATE
const muxPlaybackId = process.env.MUX_CHECK_PLAYBACK_ID
export const muxCheck =
  muxKeyId && muxKeyPrivate && muxPlaybackId
    ? { signingKeyId: muxKeyId, signingKeyPrivate: muxKeyPrivate, playbackId: muxPlaybackId }
    : null
