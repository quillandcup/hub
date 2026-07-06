import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
import { seedReferenceData } from '../../helpers/seed-data'

/**
 * When a member's email changes in Kajabi, reprocessing must update the existing
 * member row (matching by kajabi_id) rather than inserting a duplicate.
 *
 * Bug that prompted this: reprocess_members_atomic UPSERTed on email. A changed
 * email never matched an existing row, so a second member row was inserted while
 * the old row with the old email persisted untouched.
 */
describe('Member Email Change', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const kajabiContactId = `email-change-test-${ts}`
  const oldEmail = `email-change-old-${ts}@example.com`
  const newEmail = `email-change-new-${ts}@example.com`

  let prickleTypeId: string

  async function processMembers() {
    const response = await fetch(`${getTestApiBaseUrl()}/api/process/members`, {
      method: 'POST',
      headers: getTestAuthHeaders(),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`API call failed: ${response.status} - ${text}`)
    }
    return response.json()
  }

  async function cleanUp() {
    await supabase.schema('bronze').from('kajabi_contacts').delete().ilike('kajabi_contact_id', `email-change-%${ts}`)
    await supabase.from('members').delete().ilike('email', `email-change-%${ts}@example.com`)
    await supabase.from('member_email_aliases').delete().ilike('alias_email', `email-change-%${ts}@example.com`)
    await supabase.from('member_email_aliases').delete().ilike('canonical_email', `email-change-%${ts}@example.com`)
  }

  beforeAll(async () => {
    await cleanUp()
    await seedReferenceData()
    const { data: pupType } = await supabase
      .from('prickle_types')
      .select('id')
      .eq('normalized_name', 'pop-up')
      .single()
    prickleTypeId = pupType!.id
  })

  afterAll(cleanUp)

  it('updates the existing member email instead of inserting a duplicate', async () => {
    // ARRANGE: Member exists with old email
    await supabase.schema('bronze').from('kajabi_contacts').insert({
      kajabi_contact_id: kajabiContactId,
      email: oldEmail,
      name: 'Email Change Member',
      created_at_kajabi: '2023-01-01T00:00:00Z',
      data: {},
    })
    await processMembers()

    const { data: before } = await supabase.from('members').select('id, email').eq('email', oldEmail).single()
    expect(before).toBeTruthy()
    const originalId = before!.id

    // ACT: Email changes in Kajabi — update the bronze record to new email
    await supabase.schema('bronze').from('kajabi_contacts')
      .update({ email: newEmail })
      .eq('kajabi_contact_id', kajabiContactId)

    await processMembers()

    // ASSERT: new email is present, old email is gone, no duplicates
    const { data: withNewEmail } = await supabase.from('members').select('id, email').eq('email', newEmail)
    expect(withNewEmail).toHaveLength(1)
    expect(withNewEmail![0].id).toBe(originalId) // same UUID — stable identity

    const { data: withOldEmail } = await supabase.from('members').select('id').eq('email', oldEmail)
    expect(withOldEmail).toHaveLength(0)
  }, 30000)

  it('preserves UUID across email change so FK relationships remain valid', async () => {
    // UUID is already verified in the previous test; this test re-checks in isolation
    // with an explicit read-before/after pattern for clarity.
    const { data: member } = await supabase.from('members').select('id, email').eq('email', newEmail).single()
    expect(member).toBeTruthy()

    // Reprocess again (no-op for this member) — UUID must still be stable
    await processMembers()

    const { data: after } = await supabase.from('members').select('id, email').eq('email', newEmail).single()
    expect(after!.id).toBe(member!.id)
  }, 30000)

  it('creates an alias for the old email when the Kajabi email changes', async () => {
    // The alias lets re-imports that reference the old email still resolve to the member.
    const { data: member } = await supabase.from('members').select('id, email').eq('email', newEmail).single()
    expect(member).toBeTruthy()

    // Old email should now be an alias pointing to the new canonical
    const { data: alias } = await supabase
      .from('member_email_aliases')
      .select('canonical_email, alias_email, source')
      .eq('alias_email', oldEmail.toLowerCase())
      .single()

    expect(alias).toBeTruthy()
    expect(alias!.canonical_email).toBe(newEmail.toLowerCase())
    expect(alias!.source).toBe('auto_detected')

    // New canonical email must NOT appear as an alias itself
    const { data: shouldBeEmpty } = await supabase
      .from('member_email_aliases')
      .select('id')
      .eq('alias_email', newEmail.toLowerCase())
    expect(shouldBeEmpty).toHaveLength(0)

    // Clean up alias so subsequent tests start clean
    await supabase.from('member_email_aliases').delete().eq('alias_email', oldEmail.toLowerCase())
  }, 30000)

  it('redirects an existing alias chain when the canonical email changes', async () => {
    // Scenario: member has alias foo@example.com → current canonical.
    // When canonical changes, the existing alias should redirect to the new canonical.
    const { data: member } = await supabase.from('members').select('id, email').eq('email', newEmail).single()
    expect(member).toBeTruthy()

    const chainAlias = `email-change-chain-${ts}@example.com`
    await supabase.from('member_email_aliases').insert({
      canonical_email: newEmail.toLowerCase(),
      alias_email: chainAlias,
      source: 'manual',
    })

    const secondNewEmail = `email-change-second-${ts}@example.com`
    await supabase.schema('bronze').from('kajabi_contacts')
      .update({ email: secondNewEmail })
      .eq('kajabi_contact_id', kajabiContactId)

    await processMembers()

    // The chain alias should now point to the latest canonical
    const { data: updatedAlias } = await supabase
      .from('member_email_aliases')
      .select('canonical_email')
      .eq('alias_email', chainAlias)
      .single()

    expect(updatedAlias!.canonical_email).toBe(secondNewEmail.toLowerCase())

    // And the intermediate email (newEmail) should now be an alias too
    const { data: intermediateAlias } = await supabase
      .from('member_email_aliases')
      .select('canonical_email')
      .eq('alias_email', newEmail.toLowerCase())
      .single()

    expect(intermediateAlias!.canonical_email).toBe(secondNewEmail.toLowerCase())

    // Clean up
    await supabase.from('member_email_aliases').delete().ilike('alias_email', `email-change-%${ts}@example.com`)
    await supabase.schema('bronze').from('kajabi_contacts')
      .update({ email: newEmail })
      .eq('kajabi_contact_id', kajabiContactId)
    await processMembers()
  }, 60000)

  it('cleans up stale duplicate and preserves its attendance on the canonical member', async () => {
    // Simulate the state left by the old bug:
    //   - Original row: old email, correct kajabi_id  (has historical attendance)
    //   - Stale dup:    new email, same kajabi_id     (inserted by broken UPSERT, has recent attendance)
    // After fix runs:
    //   - Stale dup is deleted
    //   - Attendance from stale dup is reassigned to original (not cascade-deleted)
    //   - Original's email is updated to new email

    const staleKajabiId = `email-change-stale-${ts}`
    const staleOldEmail = `email-change-stale-old-${ts}@example.com`
    const staleNewEmail = `email-change-stale-new-${ts}@example.com`

    // Insert the original member row with old email
    const { data: originalMember } = await supabase.from('members').insert({
      email: staleOldEmail,
      kajabi_id: staleKajabiId,
      name: 'Stale Dup Member',
      joined_at: '2023-01-01',
      status: 'inactive',
      source: 'kajabi',
    }).select('id').single()

    // Insert the stale duplicate with new email (same kajabi_id) — the bug artifact
    const { data: staleDup } = await supabase.from('members').insert({
      email: staleNewEmail,
      kajabi_id: staleKajabiId,
      name: 'Stale Dup Member',
      joined_at: '2023-01-01',
      status: 'inactive',
      source: 'kajabi',
    }).select('id').single()

    // Simulate attendance that was recorded under the stale dup (the wrong member row).
    // This is the data that would have been lost before the fix.
    const { data: testPrickle } = await supabase.from('prickles').insert({
      type_id: prickleTypeId,
      start_time: '2099-09-01T10:00:00Z',
      end_time: '2099-09-01T11:00:00Z',
      source: 'zoom',
    }).select('id').single()

    await supabase.from('prickle_attendance').insert({
      member_id: staleDup!.id,
      prickle_id: testPrickle!.id,
      join_time: '2099-09-01T10:00:00Z',
      leave_time: '2099-09-01T11:00:00Z',
      confidence_score: 'high',
    })

    // Kajabi bronze has the new email now
    await supabase.schema('bronze').from('kajabi_contacts').insert({
      kajabi_contact_id: staleKajabiId,
      email: staleNewEmail,
      name: 'Stale Dup Member',
      created_at_kajabi: '2023-01-01T00:00:00Z',
      data: {},
    })

    // ACT
    await processMembers()

    // ASSERT: stale dup is gone, new email is the only row for this kajabi_id
    const { data: withNew } = await supabase.from('members').select('id, email').eq('email', staleNewEmail)
    expect(withNew).toHaveLength(1)
    expect(withNew![0].id).toBe(originalMember!.id) // canonical member's UUID preserved

    const { data: withOld } = await supabase.from('members').select('id').eq('email', staleOldEmail)
    expect(withOld).toHaveLength(0)

    // ASSERT: attendance was moved to the canonical member, not lost via CASCADE
    const { data: attendance } = await supabase
      .from('prickle_attendance')
      .select('member_id')
      .eq('prickle_id', testPrickle!.id)
    expect(attendance).toHaveLength(1)
    expect(attendance![0].member_id).toBe(originalMember!.id)

    // Clean up
    await supabase.from('prickle_attendance').delete().eq('prickle_id', testPrickle!.id)
    await supabase.from('prickles').delete().eq('id', testPrickle!.id)
    await supabase.schema('bronze').from('kajabi_contacts').delete().eq('kajabi_contact_id', staleKajabiId)
    await supabase.from('members').delete().ilike('email', `email-change-stale-%${ts}@example.com`)
  }, 30000)
})
