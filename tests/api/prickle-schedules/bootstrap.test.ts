import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders } from '../../helpers/supabase'
import { getMonthStart, getMonthEnd, getNextMonthStart } from '@/lib/prickle-schedules'

/**
 * Integration tests for POST /api/prickle-schedules/bootstrap
 * (bootstrapMonthFromCalendar in lib/prickle-schedules.ts).
 */
describe('Prickle Schedules Bootstrap API', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const testEmail = `bootstrap-test-${ts}@example.com`

  let memberId: string
  let typeId: string
  let noHostTypeId: string

  const now = new Date()
  const monthStart = getMonthStart(now)
  const monthEnd = getMonthEnd(now)
  const currentMonth = monthStart.toISOString().slice(0, 10)
  const nextMonth = getNextMonthStart(now).toISOString().slice(0, 10)

  // Every date in the current month sharing one arbitrary (but stable) weekday,
  // so the test works no matter which real month it happens to run in.
  const targetDayOfWeek = (monthStart.getUTCDay() + 2) % 7
  const weekdayDates: Date[] = []
  for (let d = new Date(monthStart); d.getTime() <= monthEnd.getTime(); d = new Date(d.getTime() + 86400000)) {
    if (d.getUTCDay() === targetDayOfWeek) weekdayDates.push(new Date(d))
  }

  // Noon UTC keeps the same calendar date in America/New_York (bootstrap's fixed
  // timezone) regardless of daylight saving, avoiding any midnight-boundary flakiness.
  function atNoonUTC(d: Date) {
    return new Date(d.getTime() + 12 * 60 * 60 * 1000).toISOString()
  }

  beforeAll(async () => {
    const { data: member } = await supabase
      .from('members')
      .insert({ name: 'Bootstrap Test Member', email: testEmail, joined_at: '2023-01-01', status: 'active' })
      .select('id')
      .single()
    memberId = member!.id

    const { data: type } = await supabase
      .from('prickle_types')
      .insert({
        name: `Bootstrap Hosting Type ${ts}`,
        normalized_name: `bootstrap-hosting-type-${ts}`,
        requires_host: true,
      })
      .select('id')
      .single()
    typeId = type!.id

    const { data: noHostType } = await supabase
      .from('prickle_types')
      .insert({
        name: `Bootstrap No-Host Type ${ts}`,
        normalized_name: `bootstrap-no-host-type-${ts}`,
        requires_host: false,
      })
      .select('id')
      .single()
    noHostTypeId = noHostType!.id

    const rows = weekdayDates.map((d) => ({
      type_id: typeId,
      host: memberId,
      title: 'Bootstrap Test Prickle',
      start_time: atNoonUTC(d),
      end_time: atNoonUTC(d),
      source: 'calendar',
    }))
    await supabase.from('prickles').insert(rows)
  })

  afterAll(async () => {
    await supabase.from('prickles').delete().eq('host', memberId)
    await supabase.from('prickle_schedules').delete().eq('host_id', memberId)
    await supabase.from('members').delete().eq('id', memberId)
    await supabase.from('prickle_types').delete().in('id', [typeId, noHostTypeId])
  })

  it('bootstraps a weekly schedule from calendar prickles and copies it to next month', async () => {
    const response = await fetch('http://localhost:3000/api/prickle-schedules/bootstrap', {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ month: currentMonth }),
    })
    expect(response.ok).toBe(true)
    const body = await response.json()
    expect(body.created).toBe(1)
    expect(body.copiedToNextMonth).toBeGreaterThanOrEqual(1)

    const { data: created } = await supabase
      .from('prickle_schedules')
      .select('*')
      .eq('host_id', memberId)
      .eq('month', currentMonth)
      .is('deleted_at', null)
    expect(created).toHaveLength(1)
    expect(created![0].recurrence_type).toBe('weekly')
    expect(created![0].day_of_week).toBe(targetDayOfWeek)
    expect(created![0].status).toBe('confirmed')
    expect(created![0].confirmed_at).not.toBeNull()

    const { data: seeded } = await supabase
      .from('prickle_schedules')
      .select('*')
      .eq('host_id', memberId)
      .eq('month', nextMonth)
      .is('deleted_at', null)
    expect(seeded).toHaveLength(1)
    expect(seeded![0].carried_forward_from).toBe(created![0].id)
    expect(seeded![0].status).toBe('proposed')
  })

  it('is idempotent: re-running skips the already-created schedule', async () => {
    const response = await fetch('http://localhost:3000/api/prickle-schedules/bootstrap', {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ month: currentMonth }),
    })
    expect(response.ok).toBe(true)
    const body = await response.json()
    expect(body.created).toBe(0)
    expect(body.skippedExisting).toBe(1)
  })

  it('ignores prickles of types that do not require a host', async () => {
    await supabase.from('prickles').insert({
      type_id: noHostTypeId,
      host: memberId,
      title: 'No-Host Prickle',
      start_time: atNoonUTC(weekdayDates[0]),
      end_time: atNoonUTC(weekdayDates[0]),
      source: 'calendar',
    })

    const response = await fetch('http://localhost:3000/api/prickle-schedules/bootstrap', {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ month: currentMonth }),
    })
    expect(response.ok).toBe(true)
    const body = await response.json()
    expect(body.created).toBe(0)

    const { data: schedules } = await supabase
      .from('prickle_schedules')
      .select('type_id')
      .eq('host_id', memberId)
      .eq('month', currentMonth)
      .is('deleted_at', null)
    expect(schedules!.every((s) => s.type_id === typeId)).toBe(true)
  })
})
