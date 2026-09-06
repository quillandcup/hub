import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders } from '../../helpers/supabase'

describe('Member Hiatus status sync', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const testEmail = `hiatus-status-sync-${ts}@example.com`

  let memberId: string

  beforeAll(async () => {
    const { data: member } = await supabase
      .from('members')
      .insert({ name: 'Hiatus Status Sync Test', email: testEmail, joined_at: '2023-01-01', status: 'active' })
      .select('id')
      .single()
    memberId = member!.id
  })

  afterAll(async () => {
    await supabase.from('members').delete().eq('id', memberId)
  })

  it('sets status to on_hiatus on create, then back off on delete', async () => {
    const createRes = await fetch('http://localhost:3000/api/member-hiatus', {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: memberId, start_date: '2020-01-01', reason: 'test' }),
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json()

    const { data: afterCreate } = await supabase.from('members').select('status').eq('id', memberId).single()
    expect(afterCreate!.status).toBe('on_hiatus')

    const delRes = await fetch(`http://localhost:3000/api/member-hiatus/${created.hiatus.id}`, {
      method: 'DELETE',
      headers: getTestAuthHeaders(),
    })
    expect(delRes.ok).toBe(true)

    const { data: afterDelete } = await supabase.from('members').select('status').eq('id', memberId).single()
    expect(afterDelete!.status).toBe('lead')
  })
})
