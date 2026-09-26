import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestSupabaseClient } from '../../helpers/supabase'

/**
 * Exercises the prickle_commitments RLS policies and table constraints directly
 * (supabase/migrations/20260926000200_create_prickle_commitments.sql), using real
 * signed-in member/admin sessions -- not the service-role client, which bypasses RLS
 * entirely and so couldn't prove anything about the policies.
 *
 * Modeled on tests/api/prickle-schedules/rls.test.ts.
 */
describe('prickle_commitments RLS', () => {
  const admin = getTestSupabaseAdminClient()
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const password = 'test-password-12345!'

  const authUserIds: string[] = []
  let memberAId: string
  let memberBId: string
  let typeId: string
  let memberAClient: ReturnType<typeof getTestSupabaseClient>
  let memberBClient: ReturnType<typeof getTestSupabaseClient>
  let adminClient: ReturnType<typeof getTestSupabaseClient>
  const anonClient = getTestSupabaseClient()

  // Each test uses its own slot (day_of_week + start time) so the partial unique
  // index on active commitments never collides across tests.
  let slotCounter = 0
  function nextSlot() {
    slotCounter += 1
    return {
      day_of_week: slotCounter % 7,
      start_time_local: `${String(6 + slotCounter).padStart(2, '0')}:00:00`,
    }
  }

  function row(memberId: string, overrides: Record<string, unknown> = {}) {
    return {
      member_id: memberId,
      type_id: typeId,
      timezone: 'America/New_York',
      start_date: '2026-10-05',
      weeks: 4,
      ...nextSlot(),
      ...overrides,
    }
  }

  async function createUser(email: string, role: 'member' | 'admin') {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error || !data.user) throw new Error(`Failed to create test user ${email}: ${error?.message}`)
    authUserIds.push(data.user.id)
    // Set role explicitly rather than relying on the on_auth_user_created default.
    await admin.from('user_profiles').update({ role }).eq('id', data.user.id)
    const client = getTestSupabaseClient()
    const { error: signInError } = await client.auth.signInWithPassword({ email, password })
    if (signInError) throw new Error(`Failed to sign in as ${email}: ${signInError.message}`)
    return client
  }

  beforeAll(async () => {
    const emailA = `commit-rls-a-${suffix}@example.com`
    const emailB = `commit-rls-b-${suffix}@example.com`
    const emailAdmin = `commit-rls-admin-${suffix}@example.com`

    const { data: members, error: membersError } = await admin
      .from('members')
      .insert([
        { name: 'Commit RLS Member A', email: emailA, joined_at: '2023-01-01', status: 'active' },
        { name: 'Commit RLS Member B', email: emailB, joined_at: '2023-01-01', status: 'active' },
      ])
      .select('id, email')
    if (membersError || !members) throw new Error(`Failed to create members: ${membersError?.message}`)
    memberAId = members.find((m) => m.email === emailA)!.id
    memberBId = members.find((m) => m.email === emailB)!.id

    const { data: type, error: typeError } = await admin
      .from('prickle_types')
      .insert({ name: `Commit RLS Type ${suffix}`, normalized_name: `commit-rls-type-${suffix}` })
      .select('id')
      .single()
    if (typeError || !type) throw new Error(`Failed to create prickle type: ${typeError?.message}`)
    typeId = type.id

    memberAClient = await createUser(emailA, 'member')
    memberBClient = await createUser(emailB, 'member')
    adminClient = await createUser(emailAdmin, 'admin')
  })

  afterAll(async () => {
    if (memberAId && memberBId) {
      await admin.from('prickle_commitments').delete().in('member_id', [memberAId, memberBId])
      await admin.from('members').delete().in('id', [memberAId, memberBId])
    }
    if (typeId) await admin.from('prickle_types').delete().eq('id', typeId)
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id).catch(() => {})
  })

  it('lets a member insert, select, and update their own commitment', async () => {
    const { data: created, error: insertError } = await memberAClient
      .from('prickle_commitments')
      .insert(row(memberAId))
      .select('id, member_id, status')
      .single()
    expect(insertError).toBeNull()
    expect(created!.member_id).toBe(memberAId)
    expect(created!.status).toBe('active')

    const { data: selected, error: selectError } = await memberAClient
      .from('prickle_commitments')
      .select('id')
      .eq('id', created!.id)
    expect(selectError).toBeNull()
    expect(selected).toHaveLength(1)

    const { data: updated, error: updateError } = await memberAClient
      .from('prickle_commitments')
      .update({ weeks: 6 })
      .eq('id', created!.id)
      .select('weeks')
    expect(updateError).toBeNull()
    expect(updated).toEqual([{ weeks: 6 }])
  })

  it("hides another member's commitments from select and silently blocks updating them", async () => {
    const { data: bRow } = await admin.from('prickle_commitments').insert(row(memberBId)).select('id').single()

    // Sanity: the row really exists (service role sees it)...
    const { data: viaService } = await admin.from('prickle_commitments').select('id').eq('id', bRow!.id)
    expect(viaService).toHaveLength(1)

    // ...but member A's session can't see it.
    const { data: viaA, error: selectError } = await memberAClient
      .from('prickle_commitments')
      .select('id')
      .eq('id', bRow!.id)
    expect(selectError).toBeNull()
    expect(viaA).toEqual([])

    // A broad select from A returns only A's own rows.
    const { data: allViaA } = await memberAClient.from('prickle_commitments').select('member_id')
    expect(allViaA!.every((r) => r.member_id === memberAId)).toBe(true)

    // UPDATE on a row the USING clause excludes affects zero rows rather than erroring.
    const { data: updated } = await memberAClient
      .from('prickle_commitments')
      .update({ weeks: 12 })
      .eq('id', bRow!.id)
      .select('weeks')
    expect(updated).toEqual([])
    const { data: unchanged } = await admin.from('prickle_commitments').select('weeks').eq('id', bRow!.id).single()
    expect(unchanged!.weeks).toBe(4)
  })

  it("blocks a member from reassigning their own commitment to another member", async () => {
    const { data: aRow } = await admin.from('prickle_commitments').insert(row(memberAId)).select('id').single()

    const { error } = await memberAClient
      .from('prickle_commitments')
      .update({ member_id: memberBId })
      .eq('id', aRow!.id)
    // WITH CHECK fails on the new row -> error, and the row keeps its owner.
    expect(error).toBeTruthy()
    const { data: after } = await admin.from('prickle_commitments').select('member_id').eq('id', aRow!.id).single()
    expect(after!.member_id).toBe(memberAId)
  })

  it('blocks a member from inserting a commitment for another member', async () => {
    const attempt = row(memberBId)
    const { data, error } = await memberAClient
      .from('prickle_commitments')
      .insert(attempt)
      .select('id')
      .single()
    expect(data).toBeNull()
    expect(error).toBeTruthy()
    expect(error!.code).toBe('42501') // insufficient_privilege: RLS WITH CHECK violation

    const { data: landed } = await admin
      .from('prickle_commitments')
      .select('id')
      .eq('member_id', memberBId)
      .eq('day_of_week', attempt.day_of_week)
      .eq('start_time_local', attempt.start_time_local)
    expect(landed).toEqual([])
  })

  it('does not let a member delete even their own commitment (no DELETE policy)', async () => {
    const { data: aRow } = await admin.from('prickle_commitments').insert(row(memberAId)).select('id').single()

    const { data: deleted, error } = await memberAClient
      .from('prickle_commitments')
      .delete()
      .eq('id', aRow!.id)
      .select('id')
    expect(error).toBeNull()
    expect(deleted).toEqual([])

    const { data: stillThere } = await admin.from('prickle_commitments').select('id').eq('id', aRow!.id)
    expect(stillThere).toHaveLength(1)
  })

  it('shows anon (signed-out) callers nothing and rejects anon inserts', async () => {
    const { data: aRow } = await admin.from('prickle_commitments').insert(row(memberAId)).select('id').single()

    const { data: viaAnon } = await anonClient.from('prickle_commitments').select('id').eq('id', aRow!.id)
    expect(viaAnon ?? []).toEqual([])

    const { data: inserted, error } = await anonClient.from('prickle_commitments').insert(row(memberAId)).select('id')
    expect(error).toBeTruthy()
    expect(inserted).toBeNull()
  })

  it("lets a real admin session read all members' commitments and update/insert another member's (sudo path)", async () => {
    const { data: aRow } = await admin.from('prickle_commitments').insert(row(memberAId)).select('id').single()
    const { data: bRow } = await admin.from('prickle_commitments').insert(row(memberBId)).select('id').single()

    const { data: seen, error: selectError } = await adminClient
      .from('prickle_commitments')
      .select('id')
      .in('id', [aRow!.id, bRow!.id])
    expect(selectError).toBeNull()
    expect(seen).toHaveLength(2)

    const { data: updated, error: updateError } = await adminClient
      .from('prickle_commitments')
      .update({ weeks: 8 })
      .eq('id', bRow!.id)
      .select('weeks')
    expect(updateError).toBeNull()
    expect(updated).toEqual([{ weeks: 8 }])

    const { data: inserted, error: insertError } = await adminClient
      .from('prickle_commitments')
      .insert(row(memberBId))
      .select('id')
      .single()
    expect(insertError).toBeNull()
    expect(inserted).toBeTruthy()
  })

  it('rejects a second active commitment for the same slot, but allows it once the first is cancelled', async () => {
    const slot = row(memberAId)

    const { data: first, error: firstError } = await memberAClient
      .from('prickle_commitments')
      .insert(slot)
      .select('id')
      .single()
    expect(firstError).toBeNull()

    const { error: dupError } = await memberAClient.from('prickle_commitments').insert(slot).select('id').single()
    expect(dupError).toBeTruthy()
    expect(dupError!.code).toBe('23505') // unique_violation

    // Member cancels (status + cancelled_at must move together per the CHECK).
    const { error: cancelError } = await memberAClient
      .from('prickle_commitments')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', first!.id)
    expect(cancelError).toBeNull()

    const { data: second, error: secondError } = await memberAClient
      .from('prickle_commitments')
      .insert(slot)
      .select('id')
      .single()
    expect(secondError).toBeNull()
    expect(second!.id).not.toBe(first!.id)
  })

  it('rejects weeks outside 1..12', async () => {
    for (const weeks of [0, 13]) {
      const { error } = await memberAClient
        .from('prickle_commitments')
        .insert(row(memberAId, { weeks }))
        .select('id')
        .single()
      expect(error, `weeks=${weeks} should be rejected`).toBeTruthy()
      expect(error!.code).toBe('23514') // check_violation
    }

    for (const weeks of [1, 12]) {
      const { error } = await memberAClient
        .from('prickle_commitments')
        .insert(row(memberAId, { weeks }))
        .select('id')
        .single()
      expect(error, `weeks=${weeks} should be accepted`).toBeNull()
    }
  })

  it('computes end_date as start_date + weeks*7 - 1 days, and recomputes it when weeks changes', async () => {
    const { data: created } = await memberAClient
      .from('prickle_commitments')
      .insert(row(memberAId, { start_date: '2026-10-05', weeks: 4 }))
      .select('id, end_date')
      .single()
    expect(created!.end_date).toBe('2026-11-01')

    const { data: updated } = await memberAClient
      .from('prickle_commitments')
      .update({ weeks: 1 })
      .eq('id', created!.id)
      .select('end_date')
      .single()
    expect(updated!.end_date).toBe('2026-10-11')

    // Crosses a year boundary.
    const { data: long } = await memberAClient
      .from('prickle_commitments')
      .insert(row(memberAId, { start_date: '2026-12-01', weeks: 12 }))
      .select('end_date')
      .single()
    expect(long!.end_date).toBe('2027-02-22')
  })
})
