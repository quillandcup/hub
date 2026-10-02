import { EmailAlertChannel } from 'checkly/constructs'
import { alertEmail } from './config'

// Notifies the engineering alerts list on failure/recovery for every monitor
// (uptime, SSL, cron heartbeats). Add more channels here (Slack, etc.) as needed.
export const ownerEmailAlert = new EmailAlertChannel('owner-email-alert', {
  address: alertEmail,
  sslExpiry: true,
})
