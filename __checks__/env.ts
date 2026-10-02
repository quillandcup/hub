// Config for the checks, read at `checkly test`/`checkly deploy` time (declared in
// env-vars.config.ts; CI passes them from GitHub Actions variables). No defaults.
function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set -- see env-vars.config.ts`)
  return value
}

/** The deployment the monitors watch, e.g. https://hub.quillandcup.com (no trailing slash). */
export const appUrl = required('NEXT_PUBLIC_APP_URL').replace(/\/+$/, '')
export const appHost = new URL(appUrl).host
export const alertEmail = required('CHECKLY_ALERT_EMAIL')
