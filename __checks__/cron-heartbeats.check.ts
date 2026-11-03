import { HeartbeatMonitor } from 'checkly/constructs'
import { ownerEmailAlert, slackAlert } from './alert-channels'
import { MONITORED_HEARTBEATS } from '../lib/cron-heartbeats'

// One heartbeat per scheduled job. The job list, periods and grace windows live in
// lib/cron-heartbeats.ts next to the ping helper the routes call, so they can't drift apart. A job marked
// `unmonitored` there (the plan's monitor limit) gets none.
for (const [job, heartbeat] of MONITORED_HEARTBEATS) {
  new HeartbeatMonitor(`cron-${job}`, {
    name: heartbeat.name,
    activated: true,
    alertChannels: [ownerEmailAlert, slackAlert],
    period: heartbeat.period,
    periodUnit: heartbeat.periodUnit,
    grace: heartbeat.grace,
    graceUnit: heartbeat.graceUnit,
  })
}
