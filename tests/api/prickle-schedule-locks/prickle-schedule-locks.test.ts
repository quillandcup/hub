import { describe, it, expect, afterEach } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders } from '../../helpers/supabase'

describe('Prickle Schedule Locks API', () => {
  const supabase = getTestSupabaseAdminClient()
  const month = '2027-01-01'

  afterEach(async () => {
    await supabase.from('prickle_schedule_locks').delete().eq('month', month)
  })

  it('returns 401 without auth', async () => {
    const response = await fetch('http://localhost:3000/api/prickle-schedule-locks')
    expect(response.status).toBe(401)
  })

  it('GET returns lock override rows', async () => {
    const response = await fetch('http://localhost:3000/api/prickle-schedule-locks', {
      headers: getTestAuthHeaders(),
    })
    expect(response.ok).toBe(true)
    const body = await response.json()
    expect(Array.isArray(body.locks)).toBe(true)
  })

  it('POST upserts a lock override', async () => {
    const response = await fetch('http://localhost:3000/api/prickle-schedule-locks', {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ month, locked: true }),
    })
    expect(response.ok).toBe(true)
    const body = await response.json()
    expect(body.lock.month.slice(0, 10)).toBe(month)
    expect(body.lock.locked).toBe(true)

    // Upsert again with locked: false -- should update, not duplicate.
    const second = await fetch('http://localhost:3000/api/prickle-schedule-locks', {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ month, locked: false }),
    })
    const secondBody = await second.json()
    expect(secondBody.lock.locked).toBe(false)

    const { data: rows } = await supabase.from('prickle_schedule_locks').select('*').eq('month', month)
    expect(rows).toHaveLength(1)
  })

  it('POST rejects a missing month', async () => {
    const response = await fetch('http://localhost:3000/api/prickle-schedule-locks', {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ locked: true }),
    })
    expect(response.status).toBe(400)
  })

  it('POST rejects a non-boolean locked value', async () => {
    const response = await fetch('http://localhost:3000/api/prickle-schedule-locks', {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ month, locked: 'yes' }),
    })
    expect(response.status).toBe(400)
  })
})
