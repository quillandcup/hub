import { EmailAlertChannel, SlackAppAlertChannel } from 'checkly/constructs'
import { alertEmail, alertsSlackChannel } from './config'

// Notifies the engineering alerts list on failure/recovery for every monitor
// (uptime, SSL, cron heartbeats).
export const ownerEmailAlert = new EmailAlertChannel('owner-email-alert', {
  address: alertEmail,
  sslExpiry: true,
})

// Posts to #hub-alerts through the Checkly Slack app (connected in Checkly's integrations page).
export const slackAlert = new SlackAppAlertChannel('hub-alerts-slack-alert', {
  slackChannels: [alertsSlackChannel],
  sendRecovery: true,
  sendFailure: true,
  sendDegraded: true,
})
