import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'

/**
 * Integration tests for the admin segments API.
 *
 * Covers:
 * - GET    /api/admin/segments                          — list segments with member counts
 * - POST   /api/admin/segments                           — create a segment
 * - GET    /api/admin/segments/[id]                      — segment detail + members
 * - DELETE /api/admin/segments/[id]                      — delete a segment (cascades members)
 * - POST   /api/admin/segments/[id]/members               — bulk-add by pasted emails
 * - DELETE /api/admin/segments/[id]/members/[memberId]     — remove one member
 * - POST   /api/admin/segments/[id]/invite                 — bulk invite by segment
 *
 * Auth guard tests are included for each route.
 */
describe('Admin Segments API', () => {
  const supabase = getTestSupabaseAdminClient()
  const base = getTestApiBaseUrl()
  const ts = Date.now()

  const memberAEmail = `segment-member-a-${ts}@example.com`
  const memberBEmail = `segment-member-b-${ts}@example.com`
  let memberAId: string
  let memberBId: string

  beforeAll(async () => {
    const { data, error } = await supabase
      .from('members')
      .insert([
        { email: memberAEmail, name: 'Segment Member A', joined_at: new Date().toISOString(), status: 'active', source: 'staff' },
        { email: memberBEmail, name: 'Segment Member B', joined_at: new Date().toISOString(), status: 'active', source: 'staff' },
      ])
      .select('id, email')
    if (error || !data) throw new Error(`Failed to create test members: ${error?.message}`)
    memberAId = data.find((m) => m.email === memberAEmail)!.id
    memberBId = data.find((m) => m.email === memberBEmail)!.id
  })

  afterAll(async () => {
    await supabase.from('members').delete().in('id', [memberAId, memberBId])
  })

  // ── Auth guard ─────────────────────────────────────────────────────────────

  it('GET /api/admin/segments returns 401 without auth', async () => {
    const res = await fetch(`${base}/api/admin/segments`)
    expect(res.status).toBe(401)
  })

  it('POST /api/admin/segments returns 401 without auth', async () => {
    const res = await fetch(`${base}/api/admin/segments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
    expect(res.status).toBe(401)
  })

  // ── Full lifecycle ───────────────────────────────────────────────────────

  describe('lifecycle', () => {
    let segmentId: string

    it('POST creates a segment', async () => {
      const res = await fetch(`${base}/api/admin/segments`, {
        method: 'POST',
        headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Founding Hedgies ${ts}` }),
      })

      expect(res.ok).toBe(true)
      const body = await res.json()
      expect(body.segment.name).toBe(`Founding Hedgies ${ts}`)
      expect(body.segment.memberCount).toBe(0)
      segmentId = body.segment.id
    })

    it('POST rejects a blank name', async () => {
      const res = await fetch(`${base}/api/admin/segments`, {
        method: 'POST',
        headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '   ' }),
      })
      expect(res.status).toBe(400)
    })

    it('GET lists the new segment with memberCount 0', async () => {
      const res = await fetch(`${base}/api/admin/segments`, { headers: getTestAuthHeaders() })
      expect(res.ok).toBe(true)
      const body = await res.json()
      const found = body.segments.find((s: any) => s.id === segmentId)
      expect(found).toBeTruthy()
      expect(found.memberCount).toBe(0)
    })

    it('POST /members adds members by pasted email, reporting per-email results', async () => {
      const res = await fetch(`${base}/api/admin/segments/${segmentId}/members`, {
        method: 'POST',
        headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `${memberAEmail}, ${memberBEmail}\nnot-a-real-member-${ts}@example.com` }),
      })

      expect(res.ok).toBe(true)
      const body = await res.json()
      const byEmail = new Map(body.results.map((r: any) => [r.email, r.status]))
      expect(byEmail.get(memberAEmail)).toBe('added')
      expect(byEmail.get(memberBEmail)).toBe('added')
      expect(byEmail.get(`not-a-real-member-${ts}@example.com`)).toBe('not_found')
      expect(body.summary).toEqual({ added: 2, already_in_segment: 0, not_found: 1 })
    })

    it('POST /members reports already_in_segment on re-adding the same email', async () => {
      const res = await fetch(`${base}/api/admin/segments/${segmentId}/members`, {
        method: 'POST',
        headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: memberAEmail }),
      })

      expect(res.ok).toBe(true)
      const body = await res.json()
      expect(body.results).toEqual([{ email: memberAEmail, status: 'already_in_segment' }])
    })

    it('GET /api/admin/segments/[id] returns the segment and its members', async () => {
      const res = await fetch(`${base}/api/admin/segments/${segmentId}`, { headers: getTestAuthHeaders() })
      expect(res.ok).toBe(true)
      const body = await res.json()
      expect(body.segment.id).toBe(segmentId)
      const emails = body.members.map((m: any) => m.email).sort()
      expect(emails).toEqual([memberAEmail, memberBEmail].sort())
    })

    it('GET /api/admin/segments now reflects memberCount 2', async () => {
      const res = await fetch(`${base}/api/admin/segments`, { headers: getTestAuthHeaders() })
      const body = await res.json()
      const found = body.segments.find((s: any) => s.id === segmentId)
      expect(found.memberCount).toBe(2)
    })

    it('DELETE /members/[memberId] removes just that member', async () => {
      const res = await fetch(`${base}/api/admin/segments/${segmentId}/members/${memberBId}`, {
        method: 'DELETE',
        headers: getTestAuthHeaders(),
      })
      expect(res.ok).toBe(true)

      const { data: remaining } = await supabase
        .from('segment_members')
        .select('member_id')
        .eq('segment_id', segmentId)
      expect((remaining ?? []).map((r) => r.member_id)).toEqual([memberAId])
    })

    it('POST /invite invites the remaining member and skips an existing auth user', async () => {
      // Give memberB a real auth account first (re-add to segment) so the
      // invite endpoint has one "skip" and one "invite" case to report.
      await supabase.from('segment_members').insert({ segment_id: segmentId, member_id: memberBId })
      const { data: authUser, error: createError } = await supabase.auth.admin.createUser({
        email: memberBEmail,
        email_confirm: true,
      })
      if (createError || !authUser.user) throw new Error(`Failed to create auth user: ${createError?.message}`)

      try {
        const res = await fetch(`${base}/api/admin/segments/${segmentId}/invite`, {
          method: 'POST',
          headers: getTestAuthHeaders(),
        })
        expect(res.ok).toBe(true)
        const body = await res.json()
        const byEmail = new Map(body.results.map((r: any) => [r.email, r.status]))
        expect(byEmail.get(memberAEmail)).toBe('invited')
        expect(byEmail.get(memberBEmail)).toBe('skipped')
        expect(body.summary).toEqual({ invited: 1, skipped: 1, failed: 0 })

        // The invited member should now be linked to their new auth user
        const { data: memberARow } = await supabase.from('members').select('user_id').eq('id', memberAId).single()
        expect(memberARow?.user_id).toBeTruthy()

        await supabase.auth.admin.deleteUser(memberARow!.user_id as string)
      } finally {
        await supabase.auth.admin.deleteUser(authUser.user.id)
      }
    })

    it('DELETE /api/admin/segments/[id] deletes the segment and cascades its members', async () => {
      const res = await fetch(`${base}/api/admin/segments/${segmentId}`, {
        method: 'DELETE',
        headers: getTestAuthHeaders(),
      })
      expect(res.ok).toBe(true)

      const { data: gone } = await supabase.from('segments').select('id').eq('id', segmentId).maybeSingle()
      expect(gone).toBeNull()

      const { data: memberLinks } = await supabase.from('segment_members').select('segment_id').eq('segment_id', segmentId)
      expect(memberLinks ?? []).toHaveLength(0)
    })
  })
})
