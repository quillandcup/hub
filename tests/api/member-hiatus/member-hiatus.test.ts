import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders } from '../../helpers/supabase'

/**
 * Integration tests for member-hiatus CRUD API
 *
 * Tests:
 * - POST /api/member-hiatus — create a hiatus period
 * - PATCH /api/member-hiatus/[id] — partial update (e.g. end early)
 * - DELETE /api/member-hiatus/[id] — delete a hiatus period
 */
describe('Member Hiatus API', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const testEmail = `hiatus-api-test-${ts}@example.com`

  let memberId: string

  beforeAll(async () => {
    const { data: member } = await supabase
      .from('members')
      .insert({ name: 'Hiatus API Test Member', email: testEmail, joined_at: '2023-01-01', status: 'active' })
      .select('id')
      .single()

    memberId = member!.id
  })

  afterAll(async () => {
    // Deleting the member cascades to member_hiatus_history
    await supabase.from('members').delete().eq('id', memberId)
  })

  it('POST creates a hiatus with valid data', async () => {
    const response = await fetch('http://localhost:3000/api/member-hiatus', {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        member_id: memberId,
        start_date: '2026-01-01',
        reason: 'travel',
        notes: 'Created by test',
      }),
    })

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.hiatus.member_id).toBe(memberId)
    expect(body.hiatus.start_date).toBe('2026-01-01')
    expect(body.hiatus.end_date).toBeNull()
    expect(body.hiatus.reason).toBe('travel')

    // Clean up
    await supabase.from('member_hiatus_history').delete().eq('id', body.hiatus.id)
  })

  it('POST rejects missing required fields', async () => {
    const response = await fetch('http://localhost:3000/api/member-hiatus', {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: memberId }),
    })

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toMatch(/Missing required fields/)
  })

  it('PATCH ends a hiatus early by setting end_date', async () => {
    const { data: created } = await supabase
      .from('member_hiatus_history')
      .insert({ member_id: memberId, start_date: '2026-01-01', reason: 'original reason' })
      .select('id')
      .single()

    const response = await fetch(`http://localhost:3000/api/member-hiatus/${created!.id}`, {
      method: 'PATCH',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ end_date: '2026-01-15' }),
    })

    expect(response.ok).toBe(true)
    const body = await response.json()
    expect(body.hiatus.end_date).toBe('2026-01-15')
    // reason should be unchanged
    expect(body.hiatus.reason).toBe('original reason')

    await supabase.from('member_hiatus_history').delete().eq('id', created!.id)
  })

  it('DELETE removes the hiatus', async () => {
    const { data: created } = await supabase
      .from('member_hiatus_history')
      .insert({ member_id: memberId, start_date: '2026-01-01', reason: 'to be deleted' })
      .select('id')
      .single()

    const response = await fetch(`http://localhost:3000/api/member-hiatus/${created!.id}`, {
      method: 'DELETE',
      headers: getTestAuthHeaders(),
    })

    expect(response.ok).toBe(true)
    const body = await response.json()
    expect(body.success).toBe(true)

    // Verify it's gone
    const { data: gone } = await supabase
      .from('member_hiatus_history')
      .select('id')
      .eq('id', created!.id)
      .single()

    expect(gone).toBeNull()
  })
})
