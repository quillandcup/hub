// Config for the checks: shared settings from app.config.ts, per-environment ones from env vars
// (env-vars.config.ts; CI passes them from GitHub Actions variables).
import appConfig from '../app.config'

/** The deployment the monitors watch, e.g. https://hub.quillandcup.com (no trailing slash). */
export const appUrl = appConfig.appUrl.replace(/\/+$/, '')
export const appHost = new URL(appUrl).host

/** The monitors watch production, so they alert production's address (eng-alerts-prod@). */
const alertsEmail = process.env.ALERTS_EMAIL
if (!alertsEmail) throw new Error('ALERTS_EMAIL is not set -- see env-vars.config.ts')
export const alertEmail: string = alertsEmail
