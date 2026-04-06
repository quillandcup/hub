import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'

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
 */
describe('Members Reprocessability', () => {
  const supabase = getTestSupabaseAdminClient()
  const testEmail1 = `reprocess-test-1-${Date.now()}@example.com`
  const testEmail2 = `reprocess-test-2-${Date.now()}@example.com`
  const testEmail3 = `reprocess-test-3-${Date.now()}@example.com`

  beforeAll(async () => {
    // Clean up any existing test data
    await supabase.from('kajabi_members').delete().ilike('email', 'reprocess-test-%')
    await supabase.from('members').delete().ilike('email', 'reprocess-test-%')
  })

  afterAll(async () => {
    // Clean up test data
    await supabase.from('kajabi_members').delete().ilike('email', 'reprocess-test-%')
    await supabase.from('members').delete().ilike('email', 'reprocess-test-%')
  })

  it('should create members from Bronze on first process', async () => {
    // ARRANGE: Insert Bronze data (subscription format)
    const bronzeData = [
      {
        email: testEmail1,
        data: {
          'Customer Name': 'Test Member 1',
          'Created At': '2022-01-01 00:00:00 -0600',
          'Status': 'Active',
          'Offer Title': 'Quill & Cup Membership',
        },
        imported_at: new Date().toISOString(),
      },
      {
        email: testEmail2,
        data: {
          'Customer Name': 'Test Member 2',
          'Created At': '2022-02-01 00:00:00 -0600',
          'Status': 'Active',
          'Offer Title': 'Quill & Cup Membership',
        },
        imported_at: new Date().toISOString(),
      },
    ]

    await supabase.from('kajabi_members').insert(bronzeData)

    // ACT: Process members
    const response = await fetch('http://localhost:3000/api/process/members', {
      method: 'POST',
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API call failed: ${response.status} - ${errorText}`)
    }

    const result = await response.json()

    // ASSERT: Members created
    expect(result.success).toBe(true)
    expect(result.processed).toBeGreaterThanOrEqual(2)

    const { data: members } = await supabase
      .from('members')
      .select('*')
      .in('email', [testEmail1, testEmail2])

    expect(members).toHaveLength(2)
    expect(members?.map(m => m.email)).toContain(testEmail1)
    expect(members?.map(m => m.email)).toContain(testEmail2)
  })

  it('should remove deleted members when reprocessing', async () => {
    // ARRANGE: Delete one member from Bronze, add a new one
    await supabase.from('kajabi_members').delete().eq('email', testEmail1)

    const newBronzeData = {
      email: testEmail3,
      data: {
        'Customer Name': 'Test Member 3',
        'Created At': '2022-03-01 00:00:00 -0600',
        'Status': 'Active',
        'Offer Title': 'Quill & Cup Membership',
      },
      imported_at: new Date().toISOString(),
    }

    await supabase.from('kajabi_members').insert(newBronzeData)

    // ACT: Reprocess members
    const response = await fetch('http://localhost:3000/api/process/members', {
      method: 'POST',
    })
    const result = await response.json()

    // ASSERT: Deleted member removed, new member added
    expect(result.success).toBe(true)

    const { data: members } = await supabase
      .from('members')
      .select('*')
      .in('email', [testEmail1, testEmail2, testEmail3])

    // Member 1 should be GONE (deleted from Bronze)
    expect(members?.map(m => m.email)).not.toContain(testEmail1)

    // Member 2 should still exist
    expect(members?.map(m => m.email)).toContain(testEmail2)

    // Member 3 should be added
    expect(members?.map(m => m.email)).toContain(testEmail3)
  })

  it('should update member status when Bronze data changes', async () => {
    // ARRANGE: Update testEmail2 status to Canceled in Bronze
    await supabase
      .from('kajabi_members')
      .update({
        data: {
          'Customer Name': 'Test Member 2',
          'Created At': '2022-02-01 00:00:00 -0600',
          'Status': 'Canceled',
          'Offer Title': 'Quill & Cup Membership',
        },
      })
      .eq('email', testEmail2)

    // ACT: Reprocess
    const response = await fetch('http://localhost:3000/api/process/members', {
      method: 'POST',
    })
    const result = await response.json()

    // ASSERT: Member status updated to inactive
    expect(result.success).toBe(true)

    const { data: member } = await supabase
      .from('members')
      .select('*')
      .eq('email', testEmail2)
      .single()

    expect(member?.status).toBe('inactive')
  })

  it('should verify DELETE + INSERT pattern (not UPSERT)', async () => {
    // ARRANGE: Insert a member directly into Silver (bypassing Bronze)
    // This simulates orphaned data that UPSERT would keep
    const orphanEmail = `orphan-${Date.now()}@example.com`

    await supabase.from('members').insert({
      email: orphanEmail,
      name: 'Orphaned Member',
      joined_at: '2022-01-01',
      status: 'active',
    })

    // Verify orphan exists
    const { data: before } = await supabase
      .from('members')
      .select('*')
      .eq('email', orphanEmail)
      .single()

    expect(before).toBeTruthy()

    // ACT: Process members (should DELETE all, then INSERT from Bronze)
    const response = await fetch('http://localhost:3000/api/process/members', {
      method: 'POST',
    })
    const result = await response.json()

    expect(result.success).toBe(true)

    // ASSERT: Orphan should be GONE (DELETE + INSERT removes it)
    // If UPSERT was used, orphan would still exist
    const { data: after } = await supabase
      .from('members')
      .select('*')
      .eq('email', orphanEmail)
      .single()

    expect(after).toBeNull()
  })
})
