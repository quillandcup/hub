// Config for the checks, from app.config.ts (shared by every environment).
import appConfig from '../app.config'

/** The deployment the monitors watch, e.g. https://hub.quillandcup.com (no trailing slash). */
export const appUrl = appConfig.appUrl.replace(/\/+$/, '')
export const appHost = new URL(appUrl).host
export const alertEmail = appConfig.checkly.alertEmail
