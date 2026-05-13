import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders } from '../../helpers/supabase'

/**
 * Integration tests for member-overrides CRUD API
 *
 * Tests:
 * - GET /api/member-overrides — list all overrides
 * - POST /api/member-overrides — create override
 * - PATCH /api/member-overrides/[id] — partial update
 * - DELETE /api/member-overrides/[id] — delete override
 */
describe('Member Overrides API', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const testEmail = `overrides-test-${ts}@example.com`

  let memberId: string

  beforeAll(async () => {
    const { data: member } = await supabase
      .from('members')
      .insert({ name: 'Override Test Member', email: testEmail, joined_at: '2023-01-01', status: 'active' })
      .select('id')
      .single()

    memberId = member!.id
  })

  afterAll(async () => {
    // Deleting the member cascades to overrides
    await supabase.from('members').delete().eq('id', memberId)
  })

  it('GET returns a list of overrides', async () => {
    const response = await fetch('http://localhost:3000/api/member-overrides', {
      headers: getTestAuthHeaders(),
    })

    expect(response.ok).toBe(true)
    const body = await response.json()
    expect(Array.isArray(body.overrides)).toBe(true)
  })

  it('POST creates an override with valid data', async () => {
    const response = await fetch('http://localhost:3000/api/member-overrides', {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        member_id: memberId,
        override_type: 'gift',
        reason: '180 program test',
        notes: 'Created by test',
      }),
    })

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.override.member_id).toBe(memberId)
    expect(body.override.override_type).toBe('gift')
    expect(body.override.reason).toBe('180 program test')
    expect(body.override.member.email).toBe(testEmail)

    // Clean up
    await supabase.from('member_status_overrides').delete().eq('id', body.override.id)
  })

  it('POST rejects invalid override_type', async () => {
    const response = await fetch('http://localhost:3000/api/member-overrides', {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        member_id: memberId,
        override_type: 'invalid_type',
        reason: 'test',
      }),
    })

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toMatch(/override_type must be one of/)
  })

  it('POST rejects missing required fields', async () => {
    const response = await fetch('http://localhost:3000/api/member-overrides', {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: memberId }),
    })

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toMatch(/Missing required fields/)
  })

  it('PATCH updates specific fields without touching others', async () => {
    // Create an override to update
    const { data: created } = await supabase
      .from('member_status_overrides')
      .insert({ member_id: memberId, override_type: 'gift', reason: 'original reason', notes: 'original notes' })
      .select('id')
      .single()

    const response = await fetch(`http://localhost:3000/api/member-overrides/${created!.id}`, {
      method: 'PATCH',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'updated reason' }),
    })

    expect(response.ok).toBe(true)
    const body = await response.json()
    expect(body.override.reason).toBe('updated reason')
    // Notes should be unchanged
    expect(body.override.notes).toBe('original notes')
    // override_type should be unchanged
    expect(body.override.override_type).toBe('gift')

    await supabase.from('member_status_overrides').delete().eq('id', created!.id)
  })

  it('PATCH rejects invalid override_type', async () => {
    const { data: created } = await supabase
      .from('member_status_overrides')
      .insert({ member_id: memberId, override_type: 'gift', reason: 'test' })
      .select('id')
      .single()

    const response = await fetch(`http://localhost:3000/api/member-overrides/${created!.id}`, {
      method: 'PATCH',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ override_type: 'bad_type' }),
    })

    expect(response.status).toBe(400)

    await supabase.from('member_status_overrides').delete().eq('id', created!.id)
  })

  it('DELETE removes the override', async () => {
    const { data: created } = await supabase
      .from('member_status_overrides')
      .insert({ member_id: memberId, override_type: 'hiatus', reason: 'to be deleted' })
      .select('id')
      .single()

    const response = await fetch(`http://localhost:3000/api/member-overrides/${created!.id}`, {
      method: 'DELETE',
      headers: getTestAuthHeaders(),
    })

    expect(response.ok).toBe(true)
    const body = await response.json()
    expect(body.success).toBe(true)

    // Verify it's gone
    const { data: gone } = await supabase
      .from('member_status_overrides')
      .select('id')
      .eq('id', created!.id)
      .single()

    expect(gone).toBeNull()
  })

  it('GET includes overrides with member details', async () => {
    const { data: created } = await supabase
      .from('member_status_overrides')
      .insert({ member_id: memberId, override_type: 'special', reason: 'GET test override' })
      .select('id')
      .single()

    const response = await fetch('http://localhost:3000/api/member-overrides', {
      headers: getTestAuthHeaders(),
    })

    const body = await response.json()
    const found = body.overrides.find((o: any) => o.id === created!.id)

    expect(found).toBeTruthy()
    expect(found.member.email).toBe(testEmail)
    expect(found.override_type).toBe('special')

    await supabase.from('member_status_overrides').delete().eq('id', created!.id)
  })
})
