import { SslMonitor, SslAssertionBuilder } from 'checkly/constructs'
import { ownerEmailAlert } from './alert-channels'

// hub.quillandcup.com specifically -- NOT the root domain, which is the
// Kajabi-hosted marketing site with an unrelated cert.
new SslMonitor('hub-ssl', {
  name: 'Hedgie Hub SSL certificate (hub.quillandcup.com)',
  activated: true,
  locations: ['us-east-1', 'eu-central-1'],
  alertChannels: [ownerEmailAlert],
  request: {
    hostname: 'hub.quillandcup.com',
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
