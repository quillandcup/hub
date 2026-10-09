import { describe, it, expect } from 'vitest'
import {
  getAffectedSilverTables,
  getProcessingOrder,
  SILVER_DEPENDENCIES,
  triggerAttendanceReprocessing,
} from '@/lib/processing/trigger'

describe('SILVER_DEPENDENCIES', () => {
  it('calendar depends on member_name_aliases as a local dep', () => {
    expect(SILVER_DEPENDENCIES.calendar.local).toContain('member_name_aliases')
  })

  it('calendar has localDefaultFutureDays of 90', () => {
    expect(SILVER_DEPENDENCIES.calendar.localDefaultFutureDays).toBe(90)
  })

  it('attendance depends on member_name_aliases as a local dep', () => {
    expect(SILVER_DEPENDENCIES.attendance.local).toContain('member_name_aliases')
  })
})

describe('getAffectedSilverTables', () => {
  it('member_name_aliases change affects both calendar and attendance', () => {
    const affected = getAffectedSilverTables('member_name_aliases', 'local')
    expect(affected).toContain('calendar')
    expect(affected).toContain('attendance')
  })

  it('prickle_types change affects calendar but not attendance', () => {
    const affected = getAffectedSilverTables('prickle_types', 'local')
    expect(affected).toContain('calendar')
    expect(affected).not.toContain('attendance')
  })

  it('ignored_zoom_names change affects attendance but not calendar', () => {
    const affected = getAffectedSilverTables('ignored_zoom_names', 'local')
    expect(affected).not.toContain('calendar')
    expect(affected).toContain('attendance')
  })

  it('calendar_events bronze change affects calendar and attendance (orphan cascade)', () => {
    const affected = getAffectedSilverTables('calendar_events', 'bronze')
    expect(affected).toContain('calendar')
    expect(affected).toContain('attendance')
  })
})

describe('slack reprocessing scope', () => {
  it('a Slack message or reaction reprocesses slack and the chat mirror, not members', () => {
    expect(getProcessingOrder(getAffectedSilverTables('slack_messages', 'bronze')).sort()).toEqual(['chat', 'slack'])
    expect(getProcessingOrder(getAffectedSilverTables('slack_reactions', 'bronze')).sort()).toEqual(['chat', 'slack'])
  })

  it('channel and membership changes only rebuild the chat mirror', () => {
    expect(getAffectedSilverTables('slack_channels', 'bronze')).toEqual(['chat'])
    expect(getAffectedSilverTables('slack_channel_members', 'bronze')).toEqual(['chat'])
  })

  it('the chat mirror runs after members', () => {
    expect(getProcessingOrder(['chat', 'members'])).toEqual(['members', 'chat'])
  })

  it('a Slack user change reprocesses members', () => {
    expect(getAffectedSilverTables('slack_users', 'bronze')).toEqual(['members'])
  })

  it('lifting or adding a channel restriction reprocesses slack and the chat mirror', () => {
    expect(getAffectedSilverTables('restricted_slack_channels', 'local').sort()).toEqual(['chat', 'slack'])
  })
})

describe('getProcessingOrder', () => {
  it('processes calendar before attendance when both are affected', () => {
    const order = getProcessingOrder(['calendar', 'attendance'])
    expect(order.indexOf('calendar')).toBeLessThan(order.indexOf('attendance'))
  })

  it('processes members before attendance', () => {
    const order = getProcessingOrder(['members', 'attendance'])
    expect(order.indexOf('members')).toBeLessThan(order.indexOf('attendance'))
  })

  it('processes members before slack regardless of input order', () => {
    expect(getProcessingOrder(['slack', 'members'])).toEqual(['members', 'slack'])
  })

  it('does not add unaffected Silver dependencies', () => {
    expect(getProcessingOrder(['slack'])).toEqual(['slack'])
    expect(getProcessingOrder(['attendance'])).toEqual(['attendance'])
  })
})

describe('triggerAttendanceReprocessing', () => {
  it('is exported from the trigger module', () => {
    expect(typeof triggerAttendanceReprocessing).toBe('function')
  })

  it('accepts a date range and returns a promise', () => {
    const from = new Date('2099-01-01')
    const to = new Date('2099-01-31')
    // We don't call it (would require a real DB), just verify it's callable with a dateRange
    expect(triggerAttendanceReprocessing.length).toBe(1) // Takes one argument (dateRange)
  })
})
