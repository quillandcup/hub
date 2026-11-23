import { UrlMonitor, UrlAssertionBuilder } from 'checkly/constructs'
import { ownerEmailAlert, slackAlert } from './alert-channels'
import { appUrl } from './config'

// Hits the public health-check route (src/app/api/health) which confirms
// Supabase connectivity, not just that Next.js is responding.
new UrlMonitor('hub-uptime', {
  // The README uptime badge shows this name, so keep it short.
  name: 'Hub uptime',
  activated: true,
  locations: ['us-east-1', 'eu-central-1'],
  alertChannels: [ownerEmailAlert, slackAlert],
  request: {
    url: `${appUrl}/api/health`,
    assertions: [
      UrlAssertionBuilder.statusCode().equals(200),
    ],
  },
})
