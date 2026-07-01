import { describe, it, expect } from 'vitest'
import {
  getAffectedSilverTables,
  getProcessingOrder,
  SILVER_DEPENDENCIES,
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

describe('getProcessingOrder', () => {
  it('processes calendar before attendance when both are affected', () => {
    const order = getProcessingOrder(['calendar', 'attendance'])
    expect(order.indexOf('calendar')).toBeLessThan(order.indexOf('attendance'))
  })

  it('processes members before attendance', () => {
    const order = getProcessingOrder(['members', 'attendance'])
    expect(order.indexOf('members')).toBeLessThan(order.indexOf('attendance'))
  })
})
