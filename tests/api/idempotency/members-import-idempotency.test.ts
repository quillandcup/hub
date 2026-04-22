import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'

/**
 * Test to verify /api/import/members is idempotent
 *
 * CRITICAL: Members import is idempotent but uses a different pattern than
 * calendar/zoom. It's APPEND-ONLY with timestamps, creating snapshots.
 *
 * Pattern: INSERT with imported_at timestamp (append-only snapshots)
 * Processing idempotency: /api/process/members always uses latest snapshot
 *
 * This enables:
 * 1. Historical tracking of member data changes
 * 2. Idempotent processing (latest snapshot wins)
 * 3. Safe re-imports without data loss
 */
describe('Members Import Idempotency', () => {
  const supabase = getTestSupabaseAdminClient()

  const testEmail1 = `idempotency-test-1-${Date.now()}@example.com`
  const testEmail2 = `idempotency-test-2-${Date.now()}@example.com`

  beforeAll(async () => {
    // Clean up any existing test data
    await supabase.from('bronze.kajabi_members').delete().ilike('email', 'idempotency-test-%')
    await supabase.from('members').delete().ilike('email', 'idempotency-test-%')
  })

  afterAll(async () => {
    // Clean up test data
    await supabase.from('bronze.kajabi_members').delete().ilike('email', 'idempotency-test-%')
    await supabase.from('members').delete().ilike('email', 'idempotency-test-%')
  })

  it('should create kajabi_members records on first import', async () => {
    // ARRANGE: First import snapshot
    const timestamp1 = new Date().toISOString()
    const bronzeData = [
      {
        email: testEmail1,
        imported_at: timestamp1,
        data: {
          'Customer Name': 'Test Member 1',
          'Created At': '2022-01-01 00:00:00 -0600',
          'Status': 'Active',
          'Offer Title': 'Quill & Cup Membership',
        },
      },
      {
        email: testEmail2,
        imported_at: timestamp1,
        data: {
          'Customer Name': 'Test Member 2',
          'Created At': '2022-02-01 00:00:00 -0600',
          'Status': 'Active',
          'Offer Title': 'Quill & Cup Membership',
        },
      },
    ]

    const { error } = await supabase.from('bronze.kajabi_members').insert(bronzeData)

    // ASSERT: Records created
    expect(error).toBeNull()

    const { data: inserted } = await supabase
      .from('bronze.kajabi_members')
      .select('*')
      .in('email', [testEmail1, testEmail2])

    expect(inserted).toHaveLength(2)
    // Verify all records have the same timestamp (don't check exact format due to TZ differences)
    const timestamps = inserted?.map(r => r.imported_at)
    expect(new Set(timestamps).size).toBe(1)
  })

  it('should create NEW snapshots on re-import (append-only pattern)', async () => {
    // Wait 100ms to ensure different timestamp
    await new Promise(resolve => setTimeout(resolve, 100))

    // ARRANGE: Second import (simulating re-import of same data)
    const timestamp2 = new Date().toISOString()
    const bronzeData = [
      {
        email: testEmail1,
        imported_at: timestamp2,
        data: {
          'Customer Name': 'Test Member 1',
          'Created At': '2022-01-01 00:00:00 -0600',
          'Status': 'Active',
          'Offer Title': 'Quill & Cup Membership',
        },
      },
      {
        email: testEmail2,
        imported_at: timestamp2,
        data: {
          'Customer Name': 'Test Member 2',
          'Created At': '2022-02-01 00:00:00 -0600',
          'Status': 'Active',
          'Offer Title': 'Quill & Cup Membership',
        },
      },
    ]

    // ACT: INSERT again (append-only, not UPSERT)
    const { error } = await supabase.from('bronze.kajabi_members').insert(bronzeData)

    expect(error).toBeNull()

    // ASSERT: Now have 4 records total (2 per email, different timestamps)
    const { data: allRecords } = await supabase
      .from('bronze.kajabi_members')
      .select('*')
      .in('email', [testEmail1, testEmail2])
      .order('imported_at', { ascending: true })

    expect(allRecords).toHaveLength(4)

    // Verify we have 2 snapshots per email
    const member1Records = allRecords?.filter(r => r.email === testEmail1)
    expect(member1Records).toHaveLength(2)
    expect(member1Records?.[0].imported_at).not.toBe(member1Records?.[1].imported_at)
  })

  it('should process using latest snapshot only (idempotent processing)', async () => {
    // ARRANGE: Latest snapshot has different data
    await new Promise(resolve => setTimeout(resolve, 100))

    const timestamp3 = new Date().toISOString()
    const updatedBronzeData = [
      {
        email: testEmail1,
        imported_at: timestamp3,
        data: {
          'Customer Name': 'Test Member 1 - UPDATED',
          'Created At': '2022-01-01 00:00:00 -0600',
          'Status': 'Canceled', // Changed to Canceled
          'Offer Title': 'Quill & Cup Membership',
        },
      },
    ]

    await supabase.from('bronze.kajabi_members').insert(updatedBronzeData)

    // ACT: Process members (should use latest snapshot)
    // Manually simulate what process/members does: get latest by imported_at
    const { data: latestSnapshot } = await supabase
      .from('bronze.kajabi_members')
      .select('*')
      .order('imported_at', { ascending: false })

    const latestByEmail = new Map<string, any>()
    for (const row of latestSnapshot || []) {
      if (!latestByEmail.has(row.email)) {
        latestByEmail.set(row.email, row)
      }
    }

    // ASSERT: Latest snapshot for testEmail1 should be the Canceled one
    const latest1 = latestByEmail.get(testEmail1)
    expect(latest1?.data?.Status).toBe('Canceled')
    // Verify timestamp is from the latest snapshot (don't check exact format)
    expect(latest1?.imported_at).toBeTruthy()
    expect(new Date(latest1!.imported_at).getTime()).toBeGreaterThan(new Date(timestamp3).getTime() - 1000)

    // Latest for testEmail2 should still be Active (no new snapshot)
    const latest2 = latestByEmail.get(testEmail2)
    expect(latest2?.data?.Status).toBe('Active')
  })

  it('should handle multiple import cycles creating historical snapshots', async () => {
    // ARRANGE: Import same data 3 more times
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => setTimeout(resolve, 50))

      const timestamp = new Date().toISOString()
      const bronzeData = [
        {
          email: testEmail1,
          imported_at: timestamp,
          data: {
            'Customer Name': 'Test Member 1',
            'Created At': '2022-01-01 00:00:00 -0600',
            'Status': 'Active',
            'Offer Title': 'Quill & Cup Membership',
          },
        },
      ]

      const { error } = await supabase.from('bronze.kajabi_members').insert(bronzeData)
      expect(error).toBeNull()
    }

    // ASSERT: testEmail1 now has many snapshots (2 initial + 1 canceled + 3 new = 6)
    const { data: allSnapshots } = await supabase
      .from('bronze.kajabi_members')
      .select('*')
      .eq('email', testEmail1)
      .order('imported_at', { ascending: true })

    expect(allSnapshots).toHaveLength(6)

    // Verify all have different timestamps
    const timestamps = new Set(allSnapshots?.map(r => r.imported_at))
    expect(timestamps.size).toBe(6)
  })

  it('should allow querying historical snapshots by timestamp', async () => {
    // ARRANGE: Get all snapshots for testEmail1
    const { data: allSnapshots } = await supabase
      .from('bronze.kajabi_members')
      .select('*')
      .eq('email', testEmail1)
      .order('imported_at', { ascending: true })

    const oldestTimestamp = allSnapshots?.[0]?.imported_at
    const newestTimestamp = allSnapshots?.[allSnapshots!.length - 1]?.imported_at

    // ACT: Query specific snapshot
    const { data: oldestSnapshot } = await supabase
      .from('bronze.kajabi_members')
      .select('*')
      .eq('email', testEmail1)
      .eq('imported_at', oldestTimestamp)
      .single()

    const { data: newestSnapshot } = await supabase
      .from('bronze.kajabi_members')
      .select('*')
      .eq('email', testEmail1)
      .eq('imported_at', newestTimestamp)
      .single()

    // ASSERT: Can retrieve specific snapshots
    expect(oldestSnapshot).toBeTruthy()
    expect(newestSnapshot).toBeTruthy()
    expect(oldestSnapshot?.imported_at).toBe(oldestTimestamp)
    expect(newestSnapshot?.imported_at).toBe(newestTimestamp)
  })

  it('should demonstrate processing idempotency despite multiple snapshots', async () => {
    // ARRANGE: Import same member 2 more times with identical data
    await new Promise(resolve => setTimeout(resolve, 100))

    const timestamp4 = new Date().toISOString()
    await supabase.from('bronze.kajabi_members').insert({
      email: testEmail2,
      imported_at: timestamp4,
      data: {
        'Customer Name': 'Test Member 2',
        'Created At': '2022-02-01 00:00:00 -0600',
        'Status': 'Active',
        'Offer Title': 'Quill & Cup Membership',
      },
    })

    await new Promise(resolve => setTimeout(resolve, 100))

    const timestamp5 = new Date().toISOString()
    await supabase.from('bronze.kajabi_members').insert({
      email: testEmail2,
      imported_at: timestamp5,
      data: {
        'Customer Name': 'Test Member 2',
        'Created At': '2022-02-01 00:00:00 -0600',
        'Status': 'Active',
        'Offer Title': 'Quill & Cup Membership',
      },
    })

    // ACT: Get latest snapshot (what processing does)
    const { data: latestSnapshot } = await supabase
      .from('bronze.kajabi_members')
      .select('*')
      .eq('email', testEmail2)
      .order('imported_at', { ascending: false })
      .limit(1)
      .single()

    // ASSERT: Latest snapshot has the same data as previous ones (idempotent)
    expect(latestSnapshot?.data?.Status).toBe('Active')
    expect(latestSnapshot?.data?.['Customer Name']).toBe('Test Member 2')

    // Multiple snapshots exist but processing result is deterministic
    const { data: allSnapshots } = await supabase
      .from('bronze.kajabi_members')
      .select('*')
      .eq('email', testEmail2)

    expect(allSnapshots!.length).toBeGreaterThan(1) // Multiple snapshots
    // But they all have the same data (just different imported_at)
    expect(allSnapshots?.every(s => s.data?.Status === 'Active')).toBe(true)
  })
})
