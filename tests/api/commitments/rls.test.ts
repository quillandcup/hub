import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestSupabaseClient } from '../../helpers/supabase'

/**
 * Exercises RLS and constraints on prickle_commitments + prickle_commitment_slots
 * (supabase/migrations/20260926000200_create_prickle_commitments.sql, restructured by
 * 20260927010000_commitment_slots.sql) using real signed-in member/admin sessions -- not the
 * service-role client, which bypasses RLS entirely and so couldn't prove anything about the
 * policies. Also covers create_prickle_commitment (the atomic create RPC the app uses) and the
 * overlap trigger that replaced the single-slot "one active commitment per slot" index.
 *
 * Modeled on tests/api/prickle-schedules/rls.test.ts.
 */
describe('prickle_commitments + prickle_commitment_slots RLS', () => {
  const admin = getTestSupabaseAdminClient()
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const password = 'test-password-12345!'
  const TZ = 'America/New_York'

  const authUserIds: string[] = []
  let memberAId: string
  let memberBId: string
  let typeId: string
  let memberAClient: ReturnType<typeof getTestSupabaseClient>
  let memberBClient: ReturnType<typeof getTestSupabaseClient>
  let adminClient: ReturnType<typeof getTestSupabaseClient>
  const anonClient = getTestSupabaseClient()

  // Each test uses its own slot times so the overlap trigger never fires across tests.
  let slotCounter = 0
  function nextSlot(dayOfWeek = 1) {
    slotCounter += 1
    const minutes = slotCounter * 5
    const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    return { type_id: typeId, day_of_week: dayOfWeek, start_time_local: time, timezone: TZ }
  }

  function commitmentRow(memberId: string, overrides: Record<string, unknown> = {}) {
    return { member_id: memberId, start_date: '2026-10-05', weeks: 4, ...overrides }
  }

  type Client = ReturnType<typeof getTestSupabaseClient>

  /** create_prickle_commitment via `client` (RLS applies), returning { id, error }. */
  async function rpcCreate(
    client: Client,
    memberId: string,
    slots: ReturnType<typeof nextSlot>[],
    opts: { start_date?: string; weeks?: number } = {},
  ) {
    const { data, error } = await client.rpc('create_prickle_commitment', {
      p_member_id: memberId,
      p_start_date: opts.start_date ?? '2026-10-05',
      p_weeks: opts.weeks ?? 4,
      p_slots: slots,
    })
    return { id: data as string | null, error }
  }

  /** Service-role insert of a commitment with slots (setup only). */
  async function seed(memberId: string, slots = [nextSlot()], overrides: Record<string, unknown> = {}) {
    const { data, error } = await admin.from('prickle_commitments').insert(commitmentRow(memberId, overrides)).select('id').single()
    if (error || !data) throw new Error(`seed failed: ${error?.message}`)
    const { error: slotError } = await admin
      .from('prickle_commitment_slots')
      .insert(slots.map((s) => ({ ...s, commitment_id: data.id })))
    if (slotError) throw new Error(`seed slots failed: ${slotError.message}`)
    return data.id as string
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
      // Slots cascade from their commitment.
      await admin.from('prickle_commitments').delete().in('member_id', [memberAId, memberBId])
      await admin.from('members').delete().in('id', [memberAId, memberBId])
    }
    if (typeId) await admin.from('prickle_types').delete().eq('id', typeId)
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id).catch(() => {})
  })

  it('no longer has the single-slot columns on prickle_commitments', async () => {
    const { error } = await admin.from('prickle_commitments').select('type_id').limit(1)
    expect(error).toBeTruthy()
    expect(error!.code).toBe('42703') // undefined_column
  })

  it('lets a member create a multi-slot commitment atomically via create_prickle_commitment, then read it', async () => {
    const slots = [nextSlot(1), nextSlot(3), nextSlot(5)]
    const { id, error } = await rpcCreate(memberAClient, memberAId, slots)
    expect(error).toBeNull()
    expect(id).toBeTruthy()

    const { data: row } = await memberAClient
      .from('prickle_commitments')
      .select('member_id, status, weeks, prickle_commitment_slots(day_of_week, start_time_local, timezone)')
      .eq('id', id!)
      .single()
    expect(row!.member_id).toBe(memberAId)
    expect(row!.status).toBe('active')
    expect(row!.prickle_commitment_slots.map((s) => s.day_of_week).sort()).toEqual([1, 3, 5])
  })

  it('create_prickle_commitment rejects an empty slot list and leaves nothing behind', async () => {
    const { error } = await rpcCreate(memberAClient, memberAId, [], { start_date: '2026-10-12' })
    expect(error).toBeTruthy()
    expect(error!.code).toBe('23514') // check_violation
    const { data } = await admin
      .from('prickle_commitments')
      .select('id, prickle_commitment_slots(id)')
      .eq('member_id', memberAId)
      .eq('start_date', '2026-10-12')
    expect(data).toEqual([])
  })

  it("won't let a member create a commitment for another member (RPC or direct), and rolls back the RPC", async () => {
    const slot = nextSlot()
    const { error: rpcError } = await rpcCreate(memberAClient, memberBId, [slot])
    expect(rpcError).toBeTruthy()
    expect(rpcError!.code).toBe('42501') // RLS WITH CHECK violation

    const { error: directError } = await memberAClient
      .from('prickle_commitments')
      .insert(commitmentRow(memberBId))
      .select('id')
      .single()
    expect(directError!.code).toBe('42501')

    const { data: landed } = await admin
      .from('prickle_commitment_slots')
      .select('id, prickle_commitments!inner(member_id)')
      .eq('prickle_commitments.member_id', memberBId)
      .eq('start_time_local', `${slot.start_time_local}:00`)
    expect(landed).toEqual([])
  })

  it("won't let a member add a slot to another member's commitment", async () => {
    const bId = await seed(memberBId)
    const { error } = await memberAClient.from('prickle_commitment_slots').insert({ ...nextSlot(), commitment_id: bId })
    expect(error).toBeTruthy()
    expect(error!.code).toBe('42501')
  })

  it("hides another member's commitments and slots from select, and silently blocks updating them", async () => {
    const bId = await seed(memberBId)

    const { data: viaA } = await memberAClient.from('prickle_commitments').select('id').eq('id', bId)
    expect(viaA).toEqual([])
    const { data: slotsViaA } = await memberAClient.from('prickle_commitment_slots').select('id').eq('commitment_id', bId)
    expect(slotsViaA).toEqual([])
    const { data: ownViaB } = await memberBClient.from('prickle_commitment_slots').select('id').eq('commitment_id', bId)
    expect(ownViaB).toHaveLength(1)

    // A broad select from A returns only A's own rows.
    const { data: allViaA } = await memberAClient.from('prickle_commitments').select('member_id')
    expect(allViaA!.every((r) => r.member_id === memberAId)).toBe(true)

    const { data: updated } = await memberAClient
      .from('prickle_commitments')
      .update({ weeks: 12 })
      .eq('id', bId)
      .select('weeks')
    expect(updated).toEqual([])
    const { data: unchanged } = await admin.from('prickle_commitments').select('weeks').eq('id', bId).single()
    expect(unchanged!.weeks).toBe(4)
  })

  it('lets a member update (cancel) their own commitment but not reassign it to another member', async () => {
    const aId = await seed(memberAId)
    const { error: reassignError } = await memberAClient
      .from('prickle_commitments')
      .update({ member_id: memberBId })
      .eq('id', aId)
    expect(reassignError).toBeTruthy()

    const { data: cancelled, error: cancelError } = await memberAClient
      .from('prickle_commitments')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', aId)
      .select('status, member_id')
    expect(cancelError).toBeNull()
    expect(cancelled).toEqual([{ status: 'cancelled', member_id: memberAId }])
  })

  it("doesn't let a member delete their commitment or edit/delete its slots (no member DELETE/UPDATE policies)", async () => {
    const aId = await seed(memberAId)

    const { data: deleted } = await memberAClient.from('prickle_commitments').delete().eq('id', aId).select('id')
    expect(deleted).toEqual([])
    const { data: slotUpdated } = await memberAClient
      .from('prickle_commitment_slots')
      .update({ day_of_week: 6 })
      .eq('commitment_id', aId)
      .select('id')
    expect(slotUpdated).toEqual([])
    const { data: slotDeleted } = await memberAClient
      .from('prickle_commitment_slots')
      .delete()
      .eq('commitment_id', aId)
      .select('id')
    expect(slotDeleted).toEqual([])

    const { data: stillThere } = await admin.from('prickle_commitment_slots').select('day_of_week').eq('commitment_id', aId)
    expect(stillThere).toEqual([{ day_of_week: 1 }])
  })

  it('shows anon (signed-out) callers nothing and rejects anon writes and RPC', async () => {
    const aId = await seed(memberAId)
    const { data: viaAnon } = await anonClient.from('prickle_commitments').select('id').eq('id', aId)
    expect(viaAnon ?? []).toEqual([])
    const { data: slotsViaAnon } = await anonClient.from('prickle_commitment_slots').select('id').eq('commitment_id', aId)
    expect(slotsViaAnon ?? []).toEqual([])

    const { error } = await anonClient.from('prickle_commitments').insert(commitmentRow(memberAId)).select('id')
    expect(error).toBeTruthy()
    const { error: rpcError } = await rpcCreate(anonClient, memberAId, [nextSlot()])
    expect(rpcError).toBeTruthy()
  })

  it("lets a real admin session read all members' commitments, create for another member (sudo path), and fix slots", async () => {
    const aId = await seed(memberAId)
    const bId = await seed(memberBId)

    const { data: seen } = await adminClient.from('prickle_commitments').select('id').in('id', [aId, bId])
    expect(seen).toHaveLength(2)
    const { data: slotsSeen } = await adminClient.from('prickle_commitment_slots').select('id').in('commitment_id', [aId, bId])
    expect(slotsSeen).toHaveLength(2)

    const { id, error } = await rpcCreate(adminClient, memberBId, [nextSlot(2), nextSlot(4)])
    expect(error).toBeNull()
    expect(id).toBeTruthy()

    const { data: fixed, error: fixError } = await adminClient
      .from('prickle_commitment_slots')
      .update({ day_of_week: 0 })
      .eq('commitment_id', bId)
      .select('day_of_week')
    expect(fixError).toBeNull()
    expect(fixed).toEqual([{ day_of_week: 0 }])
  })

  describe('overlap rule: a slot can be in only one active commitment per member at a time', () => {
    it('rejects a new commitment sharing any slot with an active one whose window overlaps, atomically', async () => {
      const mon = nextSlot(1)
      const wed = nextSlot(3)
      const { error: firstError } = await rpcCreate(memberAClient, memberAId, [mon, wed], { start_date: '2026-10-05', weeks: 4 })
      expect(firstError).toBeNull()

      // New M/W/F from week 3 shares Wed -> rejected, and none of its rows land.
      const fri = nextSlot(5)
      const { error } = await rpcCreate(memberAClient, memberAId, [nextSlot(1), wed, fri], { start_date: '2026-10-19', weeks: 2 })
      expect(error).toBeTruthy()
      expect(error!.code).toBe('23505') // unique_violation
      const { data: orphan } = await admin
        .from('prickle_commitment_slots')
        .select('id')
        .eq('start_time_local', `${fri.start_time_local}:00`)
        .eq('type_id', typeId)
      expect(orphan).toEqual([])
    })

    it('allows the same slot for another member, for a non-overlapping window (renewal), or after cancelling', async () => {
      const slot = nextSlot(2)
      const { id: first, error: firstError } = await rpcCreate(memberAClient, memberAId, [slot], { start_date: '2026-10-05', weeks: 2 })
      expect(firstError).toBeNull()

      // Another member, same slot and window.
      expect((await rpcCreate(memberBClient, memberBId, [slot], { start_date: '2026-10-05', weeks: 2 })).error).toBeNull()
      // Renewal starting the day after the first ends (10/18).
      expect((await rpcCreate(memberAClient, memberAId, [slot], { start_date: '2026-10-19', weeks: 4 })).error).toBeNull()
      // Overlapping again is rejected...
      expect((await rpcCreate(memberAClient, memberAId, [slot], { start_date: '2026-10-12', weeks: 1 })).error!.code).toBe('23505')

      // ...until the first is cancelled.
      await memberAClient
        .from('prickle_commitments')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', first!)
      expect((await rpcCreate(memberAClient, memberAId, [slot], { start_date: '2026-10-05', weeks: 2 })).error).toBeNull()
    })

    it('rejects re-activating a cancelled commitment or extending one into an overlap', async () => {
      const slot = nextSlot(4)
      const { id: early } = await rpcCreate(memberAClient, memberAId, [slot], { start_date: '2026-10-05', weeks: 1 })
      const { id: later, error } = await rpcCreate(memberAClient, memberAId, [slot], { start_date: '2026-10-12', weeks: 1 })
      expect(error).toBeNull()

      // Extending the early one to 2 weeks would overlap the later one.
      const { error: extendError } = await memberAClient.from('prickle_commitments').update({ weeks: 2 }).eq('id', early!)
      expect(extendError!.code).toBe('23505')

      await memberAClient
        .from('prickle_commitments')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', later!)
      const { error: moveError } = await memberAClient.from('prickle_commitments').update({ weeks: 2 }).eq('id', early!)
      expect(moveError).toBeNull()

      // Now the cancelled one can't come back: it would overlap the extended early one.
      const { error: reactivateError } = await memberAClient
        .from('prickle_commitments')
        .update({ status: 'active', cancelled_at: null })
        .eq('id', later!)
      expect(reactivateError!.code).toBe('23505')
    })

    it('rejects the same slot twice within one commitment', async () => {
      const slot = nextSlot()
      const { error } = await rpcCreate(memberAClient, memberAId, [slot, slot])
      expect(error!.code).toBe('23505')
    })
  })

  it('rejects weeks outside 1..12 and slot fields out of range', async () => {
    for (const weeks of [0, 13]) {
      const { error } = await rpcCreate(memberAClient, memberAId, [nextSlot()], { weeks })
      expect(error, `weeks=${weeks} should be rejected`).toBeTruthy()
      expect(error!.code).toBe('23514') // check_violation
    }
    for (const weeks of [1, 12]) {
      const { error } = await rpcCreate(memberAClient, memberAId, [nextSlot()], { weeks, start_date: weeks === 1 ? '2027-01-04' : '2027-02-01' })
      expect(error, `weeks=${weeks} should be accepted`).toBeNull()
    }
    const { error: dayError } = await rpcCreate(memberAClient, memberAId, [{ ...nextSlot(), day_of_week: 7 }])
    expect(dayError!.code).toBe('23514')
  })

  it('computes end_date as start_date + weeks*7 - 1 days, and recomputes it when weeks changes', async () => {
    const { id } = await rpcCreate(memberAClient, memberAId, [nextSlot()], { start_date: '2026-10-05', weeks: 4 })
    const { data: created } = await memberAClient.from('prickle_commitments').select('end_date').eq('id', id!).single()
    expect(created!.end_date).toBe('2026-11-01')

    const { data: updated } = await memberAClient
      .from('prickle_commitments')
      .update({ weeks: 1 })
      .eq('id', id!)
      .select('end_date')
      .single()
    expect(updated!.end_date).toBe('2026-10-11')

    // Crosses a year boundary.
    const { id: longId } = await rpcCreate(memberAClient, memberAId, [nextSlot()], { start_date: '2026-12-01', weeks: 12 })
    const { data: long } = await memberAClient.from('prickle_commitments').select('end_date').eq('id', longId!).single()
    expect(long!.end_date).toBe('2027-02-22')
  })
})
