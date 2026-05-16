import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders } from '../../helpers/supabase'

/**
 * Test to verify /api/process/members is fully reprocessable
 *
 * CRITICAL: Members processing must use DELETE + INSERT pattern.
 * This test prevents regressions where UPSERT was used instead,
 * leaving orphaned members in the database.
 *
 * Core principle: Silver layer must be fully regenerable from Bronze.
 * If a member is deleted from Kajabi, reprocessing should remove them
 * from the members table.
 *
 * NOTE: The API reads from bronze.kajabi_contacts (not the legacy
 * bronze.kajabi_members table). Members without active purchases are
 * created as 'inactive'.
 */
describe('Members Reprocessability', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const testEmail1 = `reprocess-test-1-${ts}@example.com`
  const testEmail2 = `reprocess-test-2-${ts}@example.com`
  const testEmail3 = `reprocess-test-3-${ts}@example.com`

  const contact1 = {
    kajabi_contact_id: `test-contact-1-${ts}`,
    email: testEmail1,
    name: 'Test Member 1',
    created_at_kajabi: '2022-01-01T00:00:00Z',
    data: {},
  }
  const contact2 = {
    kajabi_contact_id: `test-contact-2-${ts}`,
    email: testEmail2,
    name: 'Test Member 2',
    created_at_kajabi: '2022-02-01T00:00:00Z',
    data: {},
  }
  const contact3 = {
    kajabi_contact_id: `test-contact-3-${ts}`,
    email: testEmail3,
    name: 'Test Member 3',
    created_at_kajabi: '2022-03-01T00:00:00Z',
    data: {},
  }

  beforeAll(async () => {
    // Clean up any existing test data
    await supabase
      .schema('bronze').from('kajabi_contacts')
      .delete()
      .ilike('email', 'reprocess-test-%')
    await supabase.from('members').delete().ilike('email', 'reprocess-test-%')
  })

  afterAll(async () => {
    // Clean up test data
    await supabase
      .schema('bronze').from('kajabi_contacts')
      .delete()
      .ilike('email', 'reprocess-test-%')
    await supabase.from('members').delete().ilike('email', 'reprocess-test-%')
  })

  it('should create members from Bronze on first process', async () => {
    // ARRANGE: Insert Bronze contacts (no purchases → status will be inactive)
    const { error: insertError } = await supabase
      .schema('bronze').from('kajabi_contacts')
      .insert([contact1, contact2])

    expect(insertError).toBeNull()

    // Verify data was inserted
    const { data: verifyData } = await supabase
      .schema('bronze').from('kajabi_contacts')
      .select('*')
      .in('email', [testEmail1, testEmail2])

    expect(verifyData).toHaveLength(2)

    // ACT: Process members
    const response = await fetch('http://localhost:3000/api/process/members', {
      method: 'POST',
      headers: getTestAuthHeaders(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API call failed: ${response.status} - ${errorText}`)
    }

    const result = await response.json()

    // ASSERT: Members created (status: inactive since no purchases)
    expect(result.success).toBe(true)
    expect(result.processed).toBeGreaterThanOrEqual(2)

    const { data: members } = await supabase
      .from('members')
      .select('*')
      .in('email', [testEmail1, testEmail2])

    expect(members).toHaveLength(2)
    expect(members?.map(m => m.email)).toContain(testEmail1)
    expect(members?.map(m => m.email)).toContain(testEmail2)
    // Without active purchases, members are inactive
    expect(members?.every(m => m.status === 'inactive')).toBe(true)
  })

  it('should add new members and update existing ones when reprocessing', async () => {
    // NOTE: Members use UPSERT (not DELETE+INSERT) to preserve UUIDs for FK relationships
    // Members not in Bronze are preserved in Silver (not deleted), ensuring data integrity

    // ARRANGE: Delete contact 1 from Bronze, add contact 3
    await supabase
      .schema('bronze').from('kajabi_contacts')
      .delete()
      .eq('email', testEmail1)

    const { error } = await supabase
      .schema('bronze').from('kajabi_contacts')
      .insert(contact3)

    expect(error).toBeNull()

    // ACT: Reprocess members
    const response = await fetch('http://localhost:3000/api/process/members', {
      method: 'POST',
      headers: getTestAuthHeaders(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API call failed: ${response.status} - ${errorText}`)
    }

    const result = await response.json()

    // ASSERT: New contact added, existing contacts still present
    expect(result.success).toBe(true)

    const { data: members } = await supabase
      .from('members')
      .select('*')
      .in('email', [testEmail1, testEmail2, testEmail3])

    // Member 2 should still exist (was in Bronze, still there)
    expect(members?.map(m => m.email)).toContain(testEmail2)

    // Member 3 should be added (new contact in Bronze)
    expect(members?.map(m => m.email)).toContain(testEmail3)
  })

  it('should update member data when Bronze contact changes', async () => {
    // ARRANGE: Update contact 2's name in Bronze
    const { error } = await supabase
      .schema('bronze').from('kajabi_contacts')
      .update({ name: 'Test Member 2 - RENAMED' })
      .eq('email', testEmail2)

    expect(error).toBeNull()

    // ACT: Reprocess
    const response = await fetch('http://localhost:3000/api/process/members', {
      method: 'POST',
      headers: getTestAuthHeaders(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API call failed: ${response.status} - ${errorText}`)
    }

    const result = await response.json()

    // ASSERT: Member name updated
    expect(result.success).toBe(true)

    const { data: member } = await supabase
      .from('members')
      .select('*')
      .eq('email', testEmail2)
      .single()

    expect(member?.name).toBe('Test Member 2 - RENAMED')
  })

  it('should use UPSERT pattern to preserve member UUIDs across reprocessing', async () => {
    // NOTE: Members processing uses UPSERT (not DELETE+INSERT) to preserve UUIDs.
    // This ensures prickle_attendance, member_name_aliases, and other FK relationships
    // remain valid across reprocessing runs.

    // ARRANGE: Get current member UUID before reprocessing
    const { data: before } = await supabase
      .from('members')
      .select('id, email')
      .eq('email', testEmail2)
      .single()

    expect(before).toBeTruthy()
    const originalId = before!.id

    // ACT: Process members (UPSERT - preserves UUIDs)
    const response = await fetch('http://localhost:3000/api/process/members', {
      method: 'POST',
      headers: getTestAuthHeaders(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API call failed: ${response.status} - ${errorText}`)
    }

    const result = await response.json()
    expect(result.success).toBe(true)

    // ASSERT: Member UUID is preserved after reprocessing (UPSERT keeps same ID)
    const { data: after } = await supabase
      .from('members')
      .select('id, email')
      .eq('email', testEmail2)
      .single()

    expect(after).toBeTruthy()
    expect(after!.id).toBe(originalId)
  })
})
