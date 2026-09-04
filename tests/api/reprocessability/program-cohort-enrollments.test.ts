import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'

/**
 * member_program_enrollments + program_cohorts must drive member status the
 * same way the old member_status_overrides override_type='180_program'
 * stopgap did (see reprocess_members_atomic Steps 4a/4c/4d in
 * 20260904130000_program_cohorts_supersede_180_program.sql), but sourced
 * from a real cohort (shared start/end window) instead of a hand-typed date
 * per member, and supporting more than one enrollment per member (an alumna
 * re-enrolling in a later cohort).
 */
describe('Program cohort enrollments applied during reprocessing', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()

  const emailActive = `enrollment-active-${ts}@example.com`
  const emailHiatusWins = `enrollment-hiatus-${ts}@example.com`
  const emailLapsed = `enrollment-lapsed-${ts}@example.com`
  const emailAlumna = `enrollment-alumna-${ts}@example.com`

  let programId: string
  let memberIds: Record<string, string> = {}
  const enrollmentIds: string[] = []
  const cohortIds: string[] = []
  const hiatusIds: string[] = []

  function isoDate(offsetDays: number): string {
    const d = new Date()
    d.setDate(d.getDate() + offsetDays)
    return d.toISOString().split('T')[0]
  }

  async function processMembers() {
    const response = await fetch(`${getTestApiBaseUrl()}/api/process/members`, {
      method: 'POST',
      headers: getTestAuthHeaders(),
    })
    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} - ${await response.text()}`)
    }
    return response.json()
  }

  beforeAll(async () => {
    const { data: program, error: programError } = await supabase
      .from('programs')
      .insert({ name: `Test Program ${ts}`, slug: `test-program-${ts}` })
      .select('id')
      .single()
    expect(programError).toBeNull()
    programId = program!.id

    const { data: cohorts, error: cohortError } = await supabase
      .from('program_cohorts')
      .insert([
        { program_id: programId, name: 'Active Cohort', starts_at: isoDate(-10), expires_at: isoDate(180) },
        { program_id: programId, name: 'Lapsed Cohort', starts_at: isoDate(-200), expires_at: isoDate(-30) },
      ])
      .select('id, name')
    expect(cohortError).toBeNull()
    cohortIds.push(...(cohorts?.map((c) => c.id) ?? []))
    const activeCohortId = cohorts!.find((c) => c.name === 'Active Cohort')!.id
    const lapsedCohortId = cohorts!.find((c) => c.name === 'Lapsed Cohort')!.id

    // All four members start as 'lead' with no Kajabi footprint, so nothing
    // but the enrollment logic touches their status.
    const { data: members, error: memberError } = await supabase.from('members').insert([
      { name: 'Enrollment Active', email: emailActive, joined_at: '2023-01-01', status: 'lead' },
      { name: 'Enrollment Hiatus Wins', email: emailHiatusWins, joined_at: '2023-01-01', status: 'lead' },
      { name: 'Enrollment Lapsed', email: emailLapsed, joined_at: '2023-01-01', status: 'lead' },
      { name: 'Enrollment Alumna', email: emailAlumna, joined_at: '2023-01-01', status: 'lead' },
    ]).select('id, email')
    expect(memberError).toBeNull()
    members?.forEach((m) => { memberIds[m.email] = m.id })

    const { data: hiatuses, error: hiatusError } = await supabase
      .from('member_hiatus_history')
      .insert([
        { member_id: memberIds[emailHiatusWins], start_date: isoDate(-5), reason: 'test hiatus' },
      ])
      .select('id')
    expect(hiatusError).toBeNull()
    hiatusIds.push(...(hiatuses?.map((h) => h.id) ?? []))

    const { data: enrollments, error: enrollmentError } = await supabase
      .from('member_program_enrollments')
      .insert([
        { member_id: memberIds[emailActive], cohort_id: activeCohortId },
        { member_id: memberIds[emailHiatusWins], cohort_id: activeCohortId },
        { member_id: memberIds[emailLapsed], cohort_id: lapsedCohortId },
        // Alumna: lapsed original cohort, but also currently enrolled in the active one.
        { member_id: memberIds[emailAlumna], cohort_id: lapsedCohortId },
        { member_id: memberIds[emailAlumna], cohort_id: activeCohortId },
      ])
      .select('id')
    expect(enrollmentError).toBeNull()
    enrollmentIds.push(...(enrollments?.map((e) => e.id) ?? []))
  })

  afterAll(async () => {
    await supabase.from('member_program_enrollments').delete().in('id', enrollmentIds)
    await supabase.from('member_hiatus_history').delete().in('id', hiatusIds)
    await supabase.from('members').delete().in('id', Object.values(memberIds))
    await supabase.from('program_cohorts').delete().in('id', cohortIds)
    await supabase.from('programs').delete().eq('id', programId)
  })

  it('forces status to active for a currently-active enrollment', async () => {
    await processMembers()
    const { data: member } = await supabase.from('members').select('status').eq('email', emailActive).single()
    expect(member?.status).toBe('active')
  })

  it('keeps status active after a second reprocess run (does not revert)', async () => {
    await processMembers()
    await processMembers()
    const { data: member } = await supabase.from('members').select('status').eq('email', emailActive).single()
    expect(member?.status).toBe('active')
  })

  it('hiatus wins over a currently-active enrollment', async () => {
    await processMembers()
    const { data: member } = await supabase.from('members').select('status').eq('email', emailHiatusWins).single()
    expect(member?.status).toBe('on_hiatus')
  })

  it('flips a lapsed-enrollment lead to cancelled', async () => {
    await processMembers()
    const { data: member } = await supabase.from('members').select('status').eq('email', emailLapsed).single()
    expect(member?.status).toBe('cancelled')
  })

  it('keeps an alumna active when their newer cohort is still active, despite an older lapsed one', async () => {
    await processMembers()
    const { data: member } = await supabase.from('members').select('status').eq('email', emailAlumna).single()
    expect(member?.status).toBe('active')
  })
})
