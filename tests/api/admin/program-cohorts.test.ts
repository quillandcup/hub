import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'

/**
 * Integration tests for the programs / program-cohorts / program-enrollments
 * admin CRUD APIs (app/api/admin/programs, program-cohorts, program-enrollments).
 */
describe('Program Cohorts API', () => {
  const supabase = getTestSupabaseAdminClient()
  const baseUrl = getTestApiBaseUrl()
  const ts = Date.now()
  const testEmail = `program-cohorts-test-${ts}@example.com`

  let memberId: string
  let programId: string
  let cohortId: string

  beforeAll(async () => {
    const { data: member } = await supabase
      .from('members')
      .insert({ name: 'Program Cohorts Test Member', email: testEmail, joined_at: '2023-01-01', status: 'lead' })
      .select('id')
      .single()
    memberId = member!.id
  })

  afterAll(async () => {
    await supabase.from('members').delete().eq('id', memberId)
    if (programId) await supabase.from('programs').delete().eq('id', programId)
  })

  it('POST /api/admin/programs creates a program', async () => {
    const response = await fetch(`${baseUrl}/api/admin/programs`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Test Program ${ts}`,
        slug: `test-program-${ts}`,
        description: 'A program created by a test',
        kajabi_offer_names: ['Test Offer'],
      }),
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.program.slug).toBe(`test-program-${ts}`)
    programId = body.program.id
  })

  it('GET /api/admin/programs lists programs with cohort/enrollment counts', async () => {
    const response = await fetch(`${baseUrl}/api/admin/programs`, { headers: getTestAuthHeaders() })
    expect(response.ok).toBe(true)
    const body = await response.json()
    const found = body.programs.find((p: any) => p.id === programId)
    expect(found).toBeTruthy()
    expect(found.cohort_count).toBe(0)
  })

  it('POST /api/admin/program-cohorts creates a cohort', async () => {
    const response = await fetch(`${baseUrl}/api/admin/program-cohorts`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        program_id: programId,
        name: 'Test Cohort',
        starts_at: '2026-01-01',
        expires_at: '2026-07-01',
      }),
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.cohort.name).toBe('Test Cohort')
    cohortId = body.cohort.id
  })

  it('PATCH /api/admin/program-cohorts/[id] updates a cohort', async () => {
    const response = await fetch(`${baseUrl}/api/admin/program-cohorts/${cohortId}`, {
      method: 'PATCH',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'updated notes' }),
    })
    expect(response.ok).toBe(true)
    const body = await response.json()
    expect(body.cohort.notes).toBe('updated notes')
  })

  it('GET /api/admin/programs/[id] includes the cohort and no leakage yet', async () => {
    const response = await fetch(`${baseUrl}/api/admin/programs/${programId}`, { headers: getTestAuthHeaders() })
    expect(response.ok).toBe(true)
    const body = await response.json()
    expect(body.cohorts).toHaveLength(1)
    expect(body.leakage).toEqual([])
  })

  it('POST /api/admin/program-enrollments enrolls a member', async () => {
    const response = await fetch(`${baseUrl}/api/admin/program-enrollments`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: memberId, cohort_id: cohortId }),
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.enrollment.member.email).toBe(testEmail)
  })

  it('POST /api/admin/program-enrollments rejects a duplicate enrollment', async () => {
    const response = await fetch(`${baseUrl}/api/admin/program-enrollments`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: memberId, cohort_id: cohortId }),
    })
    expect(response.status).toBe(409)
  })

  it('GET /api/admin/programs/[id] reflects the enrollment', async () => {
    const response = await fetch(`${baseUrl}/api/admin/programs/${programId}`, { headers: getTestAuthHeaders() })
    const body = await response.json()
    expect(body.cohorts[0].member_program_enrollments).toHaveLength(1)
    expect(body.cohorts[0].member_program_enrollments[0].member.email).toBe(testEmail)
  })

  it('DELETE /api/admin/program-cohorts/[id] removes the cohort (and its enrollment)', async () => {
    const response = await fetch(`${baseUrl}/api/admin/program-cohorts/${cohortId}`, {
      method: 'DELETE',
      headers: getTestAuthHeaders(),
    })
    expect(response.ok).toBe(true)

    const { data: gone } = await supabase.from('program_cohorts').select('id').eq('id', cohortId).single()
    expect(gone).toBeNull()
  })

  it('DELETE /api/admin/programs/[id] removes the program', async () => {
    const response = await fetch(`${baseUrl}/api/admin/programs/${programId}`, {
      method: 'DELETE',
      headers: getTestAuthHeaders(),
    })
    expect(response.ok).toBe(true)
    programId = ''
  })
})
