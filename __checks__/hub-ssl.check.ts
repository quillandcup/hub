import { SslMonitor, SslAssertionBuilder } from 'checkly/constructs'
import { ownerEmailAlert } from './alert-channels'
import { appHost } from './env'

// The app's own host (NEXT_PUBLIC_APP_URL) specifically -- NOT the root domain, which is the
// Kajabi-hosted marketing site with an unrelated cert.
new SslMonitor('hub-ssl', {
  name: `Hedgie Hub SSL certificate (${appHost})`,
  activated: true,
  locations: ['us-east-1', 'eu-central-1'],
  alertChannels: [ownerEmailAlert],
  request: {
    hostname: appHost,
    port: 443,
    sslConfig: {
      alertDaysBeforeExpiry: 14,
    },
    assertions: [
      SslAssertionBuilder.certificate('daysUntilExpiry').greaterThan(14),
      SslAssertionBuilder.connection('chainTrusted').equals(true),
      SslAssertionBuilder.connection('hostnameVerified').equals(true),
    ],
  },
})
