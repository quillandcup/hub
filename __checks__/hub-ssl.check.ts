// Disabled, not deleted: we don't have enough Checkly monitor slots. The plan allows 10 uptime monitors
// (heartbeats count) and the project had 10, so `checkly deploy` was refused ("You've reached your Uptime
// Monitors limit") and the retention job's heartbeat monitor was never created. This one was the cheapest to
// give up: Vercel renews the app's certificate automatically, and `hub-uptime` fails on a bad one anyway.
// A file that declares nothing removes the monitor on the next deploy. Put the code back when the plan has
// room (docs/TODO.md: "Set the Checkly heartbeat URL for the retention job").
export {}
//
// import { SslMonitor, SslAssertionBuilder } from 'checkly/constructs'
// import { ownerEmailAlert } from './alert-channels'
// import { appHost } from './config'
//
// // The app's own host (appUrl in app.config.ts) specifically -- NOT the root domain, which is the
// // Kajabi-hosted marketing site with an unrelated cert.
// new SslMonitor('hub-ssl', {
//   name: `Hedgie Hub SSL certificate (${appHost})`,
//   activated: true,
//   locations: ['us-east-1', 'eu-central-1'],
//   alertChannels: [ownerEmailAlert],
//   request: {
//     hostname: appHost,
//     port: 443,
//     sslConfig: {
//       alertDaysBeforeExpiry: 14,
//     },
//     assertions: [
//       SslAssertionBuilder.certificate('daysUntilExpiry').greaterThan(14),
//       SslAssertionBuilder.connection('chainTrusted').equals(true),
//       SslAssertionBuilder.connection('hostnameVerified').equals(true),
//     ],
//   },
// })
