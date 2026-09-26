import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
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
    const response = await fetch(`${getTestApiBaseUrl()}/api/prickle-schedules?month=${currentMonth}`, {
      headers: getTestAuthHeaders(),
    })
    expect(response.ok).toBe(true)
    const body = await response.json()
    expect(Array.isArray(body.schedules)).toBe(true)
  })

  it('GET requires a month query parameter', async () => {
    const response = await fetch(`${getTestApiBaseUrl()}/api/prickle-schedules`, {
      headers: getTestAuthHeaders(),
    })
    expect(response.status).toBe(400)
  })

  it('POST creates a weekly schedule', async () => {
    const response = await fetch(`${getTestApiBaseUrl()}/api/prickle-schedules`, {
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
    const response = await fetch(`${getTestApiBaseUrl()}/api/prickle-schedules`, {
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
    const response = await fetch(`${getTestApiBaseUrl()}/api/prickle-schedules`, {
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
    const response = await fetch(`${getTestApiBaseUrl()}/api/prickle-schedules`, {
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

    const response = await fetch(`${getTestApiBaseUrl()}/api/prickle-schedules/${created!.id}`, {
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

    const response = await fetch(`${getTestApiBaseUrl()}/api/prickle-schedules/${created!.id}`, {
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

    const response = await fetch(`${getTestApiBaseUrl()}/api/prickle-schedules/${created!.id}`, {
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

    const listResponse = await fetch(`${getTestApiBaseUrl()}/api/prickle-schedules?month=${currentMonth}`, {
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

    const firstResponse = await fetch(`${getTestApiBaseUrl()}/api/prickle-schedules?month=${nextMonth}`, {
      headers: getTestAuthHeaders(),
    })
    const firstBody = await firstResponse.json()
    const seeded = firstBody.schedules.find((s: any) => s.carried_forward_from === confirmed!.id)
    expect(seeded).toBeTruthy()
    expect(seeded.status).toBe('proposed')
    expect(seeded.host_id).toBe(memberId)

    const secondResponse = await fetch(`${getTestApiBaseUrl()}/api/prickle-schedules?month=${nextMonth}`, {
      headers: getTestAuthHeaders(),
    })
    const secondBody = await secondResponse.json()
    const seededAgain = secondBody.schedules.filter((s: any) => s.carried_forward_from === confirmed!.id)
    expect(seededAgain).toHaveLength(1)

    await supabase.from('prickle_schedules').delete().eq('host_id', memberId).eq('day_of_week', 4)
  })

  describe('host_eligibility on GET', () => {
    // Independent re-implementation of the rule (one calendar month from the tenure
    // start, clamped to month end) on org-local (America/New_York) dates, so the test
    // doesn't just echo lib/host-eligibility.ts back at itself.
    function orgToday(): string {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date())
    }
    function addDays(date: string, days: number): string {
      const d = new Date(`${date}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + days)
      return d.toISOString().slice(0, 10)
    }
    function plusOneMonthClamped(date: string): string {
      const [y, m, d] = date.split('-').map(Number)
      const targetMonthIndex = m // 0-based index of the following month
      const lastDay = new Date(Date.UTC(y, targetMonthIndex + 1, 0)).getUTCDate()
      return new Date(Date.UTC(y, targetMonthIndex, Math.min(d, lastDay))).toISOString().slice(0, 10)
    }

    const eligSuffix = `${ts}-${Math.random().toString(36).slice(2, 8)}`
    const hostIds: string[] = []

    async function createHostWithSchedule(
      label: string,
      joinDates: { first_joined_at: string | null; most_recent_joined_at: string | null },
      dayOfWeek: number
    ): Promise<{ hostId: string; scheduleId: string }> {
      const { data: host, error: hostError } = await supabase
        .from('members')
        .insert({
          name: `Eligibility ${label} Host`,
          email: `sched-elig-${label}-${eligSuffix}@example.com`,
          status: 'active',
          // joined_at is NOT NULL but is the raw Kajabi contact date, which the rule
          // deliberately ignores -- set it far in the past so a regression that fell
          // back to it would flip the "new" / "no dates" hosts to eligible.
          joined_at: '2020-01-01',
          ...joinDates,
        })
        .select('id')
        .single()
      if (hostError || !host) throw new Error(`Failed to create ${label} host: ${hostError?.message}`)
      hostIds.push(host.id)

      const { data: schedule, error: scheduleError } = await supabase
        .from('prickle_schedules')
        .insert({
          host_id: host.id,
          type_id: typeId,
          month: currentMonth,
          recurrence_type: 'weekly',
          day_of_week: dayOfWeek,
          start_time_local: '08:00',
        })
        .select('id')
        .single()
      if (scheduleError || !schedule) throw new Error(`Failed to create ${label} schedule: ${scheduleError?.message}`)
      return { hostId: host.id, scheduleId: schedule.id }
    }

    async function getScheduleFromApi(scheduleId: string) {
      const response = await fetch(`${getTestApiBaseUrl()}/api/prickle-schedules?month=${currentMonth}`, {
        headers: getTestAuthHeaders(),
      })
      expect(response.ok).toBe(true)
      const body = await response.json()
      const schedule = body.schedules.find((s: any) => s.id === scheduleId)
      expect(schedule).toBeTruthy()
      return schedule
    }

    afterAll(async () => {
      if (hostIds.length === 0) return
      await supabase.from('prickle_schedules').delete().in('host_id', hostIds)
      await supabase.from('member_hiatus_history').delete().in('member_id', hostIds)
      await supabase.from('members').delete().in('id', hostIds)
    })

    it('marks a host who joined more than a month ago as eligible', async () => {
      const joined = addDays(orgToday(), -45)
      const { scheduleId } = await createHostWithSchedule(
        'veteran',
        { first_joined_at: joined, most_recent_joined_at: joined },
        1
      )

      const schedule = await getScheduleFromApi(scheduleId)
      expect(schedule.host_eligibility).toEqual({
        eligible: true,
        tenureStartDate: joined,
        eligibleOn: plusOneMonthClamped(joined),
      })
    })

    it('marks a host who joined 10 days ago as not yet eligible, with the date they become eligible', async () => {
      const joined = addDays(orgToday(), -10)
      const { scheduleId } = await createHostWithSchedule(
        'newbie',
        { first_joined_at: joined, most_recent_joined_at: joined },
        2
      )

      const schedule = await getScheduleFromApi(scheduleId)
      const expectedEligibleOn = plusOneMonthClamped(joined)
      expect(expectedEligibleOn > orgToday()).toBe(true)
      expect(schedule.host_eligibility).toEqual({
        eligible: false,
        tenureStartDate: joined,
        eligibleOn: expectedEligibleOn,
      })
    })

    it('marks a host with no join dates on record as not eligible, with eligibleOn null', async () => {
      const { scheduleId } = await createHostWithSchedule(
        'nodates',
        { first_joined_at: null, most_recent_joined_at: null },
        3
      )

      const schedule = await getScheduleFromApi(scheduleId)
      expect(schedule.host_eligibility).toEqual({ eligible: false, tenureStartDate: null, eligibleOn: null })
    })

    it('does not restart the clock when the most recent join is a return from hiatus', async () => {
      const first = addDays(orgToday(), -400)
      const hiatusEnd = addDays(orgToday(), -5)
      const { hostId, scheduleId } = await createHostWithSchedule(
        'hiatus',
        { first_joined_at: first, most_recent_joined_at: hiatusEnd },
        4
      )
      const { error: hiatusError } = await supabase
        .from('member_hiatus_history')
        .insert({ member_id: hostId, start_date: addDays(orgToday(), -60), end_date: hiatusEnd })
      expect(hiatusError).toBeNull()

      const schedule = await getScheduleFromApi(scheduleId)
      expect(schedule.host_eligibility).toEqual({
        eligible: true,
        tenureStartDate: first,
        eligibleOn: plusOneMonthClamped(first),
      })
    })

    it('restarts the clock for a long-time member who cancelled and rejoined 10 days ago', async () => {
      const first = addDays(orgToday(), -900)
      const rejoined = addDays(orgToday(), -10)
      const { scheduleId } = await createHostWithSchedule(
        'rejoiner',
        { first_joined_at: first, most_recent_joined_at: rejoined },
        5
      )

      const schedule = await getScheduleFromApi(scheduleId)
      expect(schedule.host_eligibility).toEqual({
        eligible: false,
        tenureStartDate: rejoined,
        eligibleOn: plusOneMonthClamped(rejoined),
      })
    })

    it('restarts the clock for a real rejoin even when the member also had an earlier, finished hiatus', async () => {
      const first = addDays(orgToday(), -900)
      const rejoined = addDays(orgToday(), -10)
      const { hostId, scheduleId } = await createHostWithSchedule(
        'hiatus-then-rejoin',
        { first_joined_at: first, most_recent_joined_at: rejoined },
        6
      )
      // The hiatus ended long before the rejoin, so most_recent_joined_at is a real rejoin, not a hiatus return.
      const { error: hiatusError } = await supabase
        .from('member_hiatus_history')
        .insert({ member_id: hostId, start_date: addDays(orgToday(), -500), end_date: addDays(orgToday(), -400) })
      expect(hiatusError).toBeNull()

      const schedule = await getScheduleFromApi(scheduleId)
      expect(schedule.host_eligibility).toEqual({
        eligible: false,
        tenureStartDate: rejoined,
        eligibleOn: plusOneMonthClamped(rejoined),
      })
    })

    it('makes a rejoiner eligible once a full month has passed since the rejoin', async () => {
      const first = addDays(orgToday(), -900)
      const rejoined = addDays(orgToday(), -40)
      const { scheduleId } = await createHostWithSchedule(
        'settled-rejoiner',
        { first_joined_at: first, most_recent_joined_at: rejoined },
        0
      )

      const schedule = await getScheduleFromApi(scheduleId)
      expect(schedule.host_eligibility).toEqual({
        eligible: true,
        tenureStartDate: rejoined,
        eligibleOn: plusOneMonthClamped(rejoined),
      })
    })
  })
})
