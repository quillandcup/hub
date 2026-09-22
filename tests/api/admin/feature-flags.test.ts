import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'

/**
 * Integration tests for the admin feature-flags API.
 *
 * Covers:
 * - GET    /api/admin/feature-flags                              — list all known flags
 * - PATCH  /api/admin/feature-flags/[key]                        — toggle enabled_globally
 * - POST   /api/admin/feature-flags/[key]/segments                — attach a segment
 * - DELETE /api/admin/feature-flags/[key]/segments/[segmentId]     — detach a segment
 *
 * Auth guard tests are included for each route.
 */
describe('Admin Feature Flags API', () => {
  const supabase = getTestSupabaseAdminClient()
  const base = getTestApiBaseUrl()
  const ts = Date.now()
  const testKey = `test_flag_${ts}`

  let segmentId: string

  beforeAll(async () => {
    const { data, error } = await supabase
      .from('segments')
      .insert({ name: `Flag Target Segment ${ts}` })
      .select('id')
      .single()
    if (error || !data) throw new Error(`Failed to create test segment: ${error?.message}`)
    segmentId = data.id
  })

  afterAll(async () => {
    await supabase.from('feature_flags').delete().eq('feature_key', testKey)
    await supabase.from('segments').delete().eq('id', segmentId)
  })

  // ── Auth guard ─────────────────────────────────────────────────────────────

  it('GET returns 401 without auth', async () => {
    const res = await fetch(`${base}/api/admin/feature-flags`)
    expect(res.status).toBe(401)
  })

  it('PATCH returns 401 without auth', async () => {
    const res = await fetch(`${base}/api/admin/feature-flags/${testKey}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabledGlobally: true }),
    })
    expect(res.status).toBe(401)
  })

  it('POST segments returns 401 without auth', async () => {
    const res = await fetch(`${base}/api/admin/feature-flags/${testKey}/segments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segmentId }),
    })
    expect(res.status).toBe(401)
  })

  // ── GET ────────────────────────────────────────────────────────────────────

  it('GET includes wheel_of_wonder, backfilled by the registry migration', async () => {
    const res = await fetch(`${base}/api/admin/feature-flags`, { headers: getTestAuthHeaders() })
    expect(res.ok).toBe(true)
    const body = await res.json()
    const found = body.flags.find((f: any) => f.key === 'wheel_of_wonder')
    expect(found).toBeTruthy()
    expect(typeof found.enabledGlobally).toBe('boolean')
    expect(Array.isArray(found.segments)).toBe(true)
  })

  // ── PATCH enabled_globally ───────────────────────────────────────────────

  it('PATCH turns a flag on globally, upserting a registry row for a brand-new key', async () => {
    const res = await fetch(`${base}/api/admin/feature-flags/${testKey}`, {
      method: 'PATCH',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabledGlobally: true }),
    })
    expect(res.ok).toBe(true)

    const { data: row } = await supabase
      .from('feature_flags')
      .select('enabled_globally')
      .eq('feature_key', testKey)
      .single()
    expect(row?.enabled_globally).toBe(true)
  })

  it('PATCH turns a flag back off', async () => {
    const res = await fetch(`${base}/api/admin/feature-flags/${testKey}`, {
      method: 'PATCH',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabledGlobally: false }),
    })
    expect(res.ok).toBe(true)

    const { data: row } = await supabase
      .from('feature_flags')
      .select('enabled_globally')
      .eq('feature_key', testKey)
      .single()
    expect(row?.enabled_globally).toBe(false)
  })

  it('PATCH rejects a non-boolean enabledGlobally', async () => {
    const res = await fetch(`${base}/api/admin/feature-flags/${testKey}`, {
      method: 'PATCH',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabledGlobally: 'yes' }),
    })
    expect(res.status).toBe(400)
  })

  // ── Segment targeting ────────────────────────────────────────────────────

  it('POST /segments attaches a segment to the flag', async () => {
    const res = await fetch(`${base}/api/admin/feature-flags/${testKey}/segments`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ segmentId }),
    })
    expect(res.ok).toBe(true)

    const listRes = await fetch(`${base}/api/admin/feature-flags`, { headers: getTestAuthHeaders() })
    const body = await listRes.json()
    const found = body.flags.find((f: any) => f.key === testKey)
    expect(found.segments.map((s: any) => s.id)).toEqual([segmentId])
  })

  it('DELETE /segments/[segmentId] detaches the segment', async () => {
    const res = await fetch(`${base}/api/admin/feature-flags/${testKey}/segments/${segmentId}`, {
      method: 'DELETE',
      headers: getTestAuthHeaders(),
    })
    expect(res.ok).toBe(true)

    const listRes = await fetch(`${base}/api/admin/feature-flags`, { headers: getTestAuthHeaders() })
    const body = await listRes.json()
    const found = body.flags.find((f: any) => f.key === testKey)
    expect(found.segments).toEqual([])
  })
})
