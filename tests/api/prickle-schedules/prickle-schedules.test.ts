import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders } from '../../helpers/supabase'
import { getMonthStart, getNextMonthStart } from '@/lib/prickle-schedules'

/**
 * Integration tests for the admin prickle-schedules CRUD API
 * (app/api/prickle-schedules/route.ts, [id]/route.ts).
 */
describe('Prickle Schedules API', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const testEmail = `schedules-test-${ts}@example.com`

  let memberId: string
  let typeId: string
  const now = new Date()
  const currentMonth = getMonthStart(now).toISOString().slice(0, 10)
  const nextMonth = getNextMonthStart(now).toISOString().slice(0, 10)

  beforeAll(async () => {
    const { data: member } = await supabase
      .from('members')
      .insert({ name: 'Schedule Test Member', email: testEmail, joined_at: '2023-01-01', status: 'active' })
      .select('id')
      .single()
    memberId = member!.id

    const { data: type } = await supabase
      .from('prickle_types')
      .insert({
        name: `Test Hosting Type ${ts}`,
        normalized_name: `test-hosting-type-${ts}`,
        requires_host: true,
      })
      .select('id')
      .single()
    typeId = type!.id
  })

  afterAll(async () => {
    await supabase.from('prickle_schedules').delete().eq('host_id', memberId)
    await supabase.from('members').delete().eq('id', memberId)
    await supabase.from('prickle_types').delete().eq('id', typeId)
  })

  it('GET returns schedules for the requested month', async () => {
    const response = await fetch(`http://localhost:3000/api/prickle-schedules?month=${currentMonth}`, {
      headers: getTestAuthHeaders(),
    })
    expect(response.ok).toBe(true)
    const body = await response.json()
    expect(Array.isArray(body.schedules)).toBe(true)
  })

  it('GET requires a month query parameter', async () => {
    const response = await fetch('http://localhost:3000/api/prickle-schedules', {
      headers: getTestAuthHeaders(),
    })
    expect(response.status).toBe(400)
  })

  it('POST creates a weekly schedule', async () => {
    const response = await fetch('http://localhost:3000/api/prickle-schedules', {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host_id: memberId,
        type_id: typeId,
        month: currentMonth,
        recurrence_type: 'weekly',
        day_of_week: 2,
        start_time_local: '19:00',
      }),
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.schedule.status).toBe('proposed')
    expect(body.schedule.member.email).toBe(testEmail)
    expect(body.schedule.prickle_type.id).toBe(typeId)

    await supabase.from('prickle_schedules').delete().eq('id', body.schedule.id)
  })

  it('POST creates a biweekly schedule requiring an anchor date', async () => {
    const response = await fetch('http://localhost:3000/api/prickle-schedules', {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host_id: memberId,
        type_id: typeId,
        month: currentMonth,
        recurrence_type: 'biweekly',
        day_of_week: 2,
        recurrence_anchor_date: '2026-09-01',
        start_time_local: '19:00',
      }),
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    await supabase.from('prickle_schedules').delete().eq('id', body.schedule.id)
  })

  it('POST rejects biweekly without an anchor date', async () => {
    const response = await fetch('http://localhost:3000/api/prickle-schedules', {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host_id: memberId,
        type_id: typeId,
        month: currentMonth,
        recurrence_type: 'biweekly',
        day_of_week: 2,
        start_time_local: '19:00',
      }),
    })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toMatch(/recurrence_anchor_date is required/)
  })

  it('POST rejects an invalid recurrence_type', async () => {
    const response = await fetch('http://localhost:3000/api/prickle-schedules', {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host_id: memberId,
        type_id: typeId,
        month: currentMonth,
        recurrence_type: 'yearly',
        start_time_local: '19:00',
      }),
    })
    expect(response.status).toBe(400)
  })

  it('PATCH confirms a schedule, setting confirmed_by/confirmed_at server-side', async () => {
    const { data: created } = await supabase
      .from('prickle_schedules')
      .insert({
        host_id: memberId,
        type_id: typeId,
        month: currentMonth,
        recurrence_type: 'weekly',
        day_of_week: 2,
        start_time_local: '19:00',
      })
      .select('id')
      .single()

    const response = await fetch(`http://localhost:3000/api/prickle-schedules/${created!.id}`, {
      method: 'PATCH',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      // Client-supplied confirmed_by/confirmed_at must be ignored.
      body: JSON.stringify({ status: 'confirmed', confirmed_by: 'attacker-id', confirmed_at: '1999-01-01' }),
    })
    expect(response.ok).toBe(true)
    const body = await response.json()
    expect(body.schedule.status).toBe('confirmed')
    expect(body.schedule.confirmed_at).not.toBe('1999-01-01')
    expect(body.schedule.confirmed_by).not.toBe('attacker-id')

    await supabase.from('prickle_schedules').delete().eq('id', created!.id)
  })

  it('PATCH rejects an invalid status', async () => {
    const { data: created } = await supabase
      .from('prickle_schedules')
      .insert({
        host_id: memberId,
        type_id: typeId,
        month: currentMonth,
        recurrence_type: 'weekly',
        day_of_week: 2,
        start_time_local: '19:00',
      })
      .select('id')
      .single()

    const response = await fetch(`http://localhost:3000/api/prickle-schedules/${created!.id}`, {
      method: 'PATCH',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'bogus' }),
    })
    expect(response.status).toBe(400)

    await supabase.from('prickle_schedules').delete().eq('id', created!.id)
  })

  it('DELETE soft-deletes: the row survives with deleted_at set and is excluded from GET', async () => {
    const { data: created } = await supabase
      .from('prickle_schedules')
      .insert({
        host_id: memberId,
        type_id: typeId,
        month: currentMonth,
        recurrence_type: 'weekly',
        day_of_week: 3,
        start_time_local: '19:00',
      })
      .select('id')
      .single()

    const response = await fetch(`http://localhost:3000/api/prickle-schedules/${created!.id}`, {
      method: 'DELETE',
      headers: getTestAuthHeaders(),
    })
    expect(response.ok).toBe(true)

    const { data: row } = await supabase
      .from('prickle_schedules')
      .select('deleted_at')
      .eq('id', created!.id)
      .single()
    expect(row!.deleted_at).not.toBeNull()

    const listResponse = await fetch(`http://localhost:3000/api/prickle-schedules?month=${currentMonth}`, {
      headers: getTestAuthHeaders(),
    })
    const listBody = await listResponse.json()
    expect(listBody.schedules.find((s: any) => s.id === created!.id)).toBeUndefined()

    await supabase.from('prickle_schedules').delete().eq('id', created!.id)
  })

  it('GET on next month seeds a proposed continuation from a confirmed current-month slot, and is idempotent', async () => {
    const { data: confirmed } = await supabase
      .from('prickle_schedules')
      .insert({
        host_id: memberId,
        type_id: typeId,
        month: currentMonth,
        recurrence_type: 'weekly',
        day_of_week: 4,
        start_time_local: '19:00',
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    const firstResponse = await fetch(`http://localhost:3000/api/prickle-schedules?month=${nextMonth}`, {
      headers: getTestAuthHeaders(),
    })
    const firstBody = await firstResponse.json()
    const seeded = firstBody.schedules.find((s: any) => s.carried_forward_from === confirmed!.id)
    expect(seeded).toBeTruthy()
    expect(seeded.status).toBe('proposed')
    expect(seeded.host_id).toBe(memberId)

    const secondResponse = await fetch(`http://localhost:3000/api/prickle-schedules?month=${nextMonth}`, {
      headers: getTestAuthHeaders(),
    })
    const secondBody = await secondResponse.json()
    const seededAgain = secondBody.schedules.filter((s: any) => s.carried_forward_from === confirmed!.id)
    expect(seededAgain).toHaveLength(1)

    await supabase.from('prickle_schedules').delete().eq('host_id', memberId).eq('day_of_week', 4)
  })
})
