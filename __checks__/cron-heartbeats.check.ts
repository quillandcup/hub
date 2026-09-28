import { HeartbeatMonitor } from 'checkly/constructs'
import { ownerEmailAlert } from './alert-channels'
import { CRON_HEARTBEATS } from '../lib/cron-heartbeats'

// One heartbeat per scheduled job. The job list, periods and grace windows live in
// lib/cron-heartbeats.ts next to the ping helper the routes call, so they can't drift apart.
for (const [job, heartbeat] of Object.entries(CRON_HEARTBEATS)) {
  new HeartbeatMonitor(`cron-${job}`, {
    name: heartbeat.name,
    activated: true,
    alertChannels: [ownerEmailAlert],
    period: heartbeat.period,
    periodUnit: heartbeat.periodUnit,
    grace: heartbeat.grace,
    graceUnit: heartbeat.graceUnit,
  })
}
