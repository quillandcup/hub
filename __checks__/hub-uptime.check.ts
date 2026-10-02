import { UrlMonitor, UrlAssertionBuilder } from 'checkly/constructs'
import { ownerEmailAlert } from './alert-channels'
import { appHost, appUrl } from './env'

// Hits the public health-check route (app/api/health) which confirms
// Supabase connectivity, not just that Next.js is responding.
new UrlMonitor('hub-uptime', {
  name: `Hedgie Hub uptime (${appHost})`,
  activated: true,
  locations: ['us-east-1', 'eu-central-1'],
  alertChannels: [ownerEmailAlert],
  request: {
    url: `${appUrl}/api/health`,
    assertions: [
      UrlAssertionBuilder.statusCode().equals(200),
    ],
  },
})
