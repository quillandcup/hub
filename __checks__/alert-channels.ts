import { EmailAlertChannel } from 'checkly/constructs'
import { alertEmail } from './config'

// Notifies the account owner's email on failure/recovery for both uptime
// and SSL monitors. Add more channels here (Slack, etc.) as the team grows.
export const ownerEmailAlert = new EmailAlertChannel('owner-email-alert', {
  address: alertEmail,
  sslExpiry: true,
})
