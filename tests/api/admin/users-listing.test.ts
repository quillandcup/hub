import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
import { apiFetch } from '../../helpers/api-fetch'

import { SupabaseAuthUserRepository } from '@/lib/data/auth-users'

/**
 * GET /api/admin/users: the aliases of a user's linked member (what the Users search matches on),
 * and the Auth listing failing. POST /api/admin/segments/[id]/invite: the same listing failing.
 */
describe('Admin users and invite: aliases and the auth-user listing', () => {
  const supabase = getTestSupabaseAdminClient()
  const base = getTestApiBaseUrl()
  const ts = Date.now()
  const email = `users-listing-${ts}@example.com`
  const nameAlias = `Listing Alias ${ts}`
  const emailAlias = `listing-alias-${ts}@example.com`

  let authUserId: string
  let memberId: string
  let segmentId: string

  beforeAll(async () => {
    const { data: auth, error: authError } = await supabase.auth.admin.createUser({ email, email_confirm: true })
    if (authError || !auth.user) throw new Error(`Failed to create auth user: ${authError?.message}`)
    authUserId = auth.user.id

    const { data: member, error: memberError } = await supabase
      .from('members')
      .insert({ email, name: 'Listing Test', joined_at: new Date().toISOString(), status: 'active', source: 'staff', user_id: authUserId })
      .select('id')
      .single()
    if (memberError || !member) throw new Error(`Failed to create member: ${memberError?.message}`)
    memberId = member.id

    await supabase.from('member_name_aliases').insert({ member_id: memberId, alias: nameAlias, source: 'zoom', active: true })
    await supabase.from('member_email_aliases').insert({ member_id: memberId, alias_email: emailAlias, source: 'manual' } as never)

    const { data: segment, error: segmentError } = await supabase.from('segments').insert({ name: `Listing Segment ${ts}` }).select('id').single()
    if (segmentError || !segment) throw new Error(`Failed to create segment: ${segmentError?.message}`)
    segmentId = segment.id
  })

  afterAll(async () => {
    await supabase.from('segments').delete().eq('id', segmentId)
    await supabase.from('member_name_aliases').delete().eq('member_id', memberId)
    await supabase.from('member_email_aliases').delete().eq('member_id', memberId)
    await supabase.from('members').delete().eq('id', memberId)
    await supabase.auth.admin.deleteUser(authUserId).catch(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it('GET gives each user the name and email aliases of their linked member', async () => {
    const res = await apiFetch(`${base}/api/admin/users`, { headers: getTestAuthHeaders() })
    expect(res.ok).toBe(true)
    const body = await res.json()
    const row = body.users.find((u: { id: string }) => u.id === authUserId)
    expect(row.aliases.sort()).toEqual([emailAlias, nameAlias].sort())
    // Created through the admin API and never signed in: no last sign-in.
    expect(row.lastSignInAt).toBeNull()
    // A user with no linked member has no aliases (vacuously true if every user here is linked).
    const unlinked = body.users.filter((u: { memberId: string | null }) => u.memberId === null)
    expect(unlinked.every((u: { aliases: string[] }) => u.aliases.length === 0)).toBe(true)
  })

  it('GET answers 500 with the reason when the auth users cannot be listed', async () => {
    vi.spyOn(SupabaseAuthUserRepository.prototype, 'all').mockRejectedValueOnce(new Error('listUsers failed: boom'))
    const res = await apiFetch(`${base}/api/admin/users`, { headers: getTestAuthHeaders() })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('listUsers failed: boom')
  })

  it('invite answers 500, inviting no one, when the auth users cannot be listed', async () => {
    await supabase.from('segment_members').insert({ segment_id: segmentId, member_id: memberId })
    vi.spyOn(SupabaseAuthUserRepository.prototype, 'all').mockRejectedValueOnce(new Error('listUsers failed: boom'))
    const res = await apiFetch(`${base}/api/admin/segments/${segmentId}/invite`, { method: 'POST', headers: getTestAuthHeaders() })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('listUsers failed: boom')
  })
})
