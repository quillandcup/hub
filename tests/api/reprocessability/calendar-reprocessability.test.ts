import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'

/**
 * Test to verify /api/process/calendar is fully reprocessable
 *
 * CRITICAL: Calendar processing must use DELETE + INSERT pattern.
 * This test prevents regressions where selective INSERT/UPDATE was used,
 * leaving orphaned prickles when calendar events are deleted.
 *
 * Core principle: Silver layer must be fully regenerable from Bronze.
 * If a calendar event is deleted, reprocessing should remove the
 * corresponding prickle from the database.
 */
describe('Calendar Reprocessability', () => {
  const supabase = getTestSupabaseAdminClient()
  const testDateRange = {
    from: '2099-06-01T00:00:00Z',
    to: '2099-06-30T23:59:59Z',
  }

  let prickleTypeId: string

  beforeAll(async () => {
    // Get a prickle type for testing
    const { data: prickleType } = await supabase
      .from('prickle_types')
      .select('id')
      .limit(1)
      .single()

    prickleTypeId = prickleType!.id

    // Clean up any existing test data
    await supabase
      .from('prickles')
      .delete()
      .eq('source', 'calendar')
      .gte('start_time', testDateRange.from)
      .lte('end_time', testDateRange.to)

    await supabase
      .from('calendar_events')
      .delete()
      .gte('start_time', testDateRange.from)
      .lte('end_time', testDateRange.to)
  })

  afterAll(async () => {
    // Clean up test data
    await supabase
      .from('prickles')
      .delete()
      .eq('source', 'calendar')
      .gte('start_time', testDateRange.from)
      .lte('end_time', testDateRange.to)

    await supabase
      .from('calendar_events')
      .delete()
      .gte('start_time', testDateRange.from)
      .lte('end_time', testDateRange.to)
  })

  it('should create prickles from calendar events on first process', async () => {
    // ARRANGE: Insert Bronze calendar events
    const bronzeEvents = [
      {
        google_event_id: 'test-event-1',
        summary: 'Morning Pages',
        start_time: '2099-06-15T09:00:00Z',
        end_time: '2099-06-15T10:00:00Z',
        creator_email: 'test@example.com',
      },
      {
        google_event_id: 'test-event-2',
        summary: 'Deep Work',
        start_time: '2099-06-16T14:00:00Z',
        end_time: '2099-06-16T16:00:00Z',
        creator_email: 'test@example.com',
      },
    ]

    await supabase.from('calendar_events').insert(bronzeEvents)

    // ACT: Process calendar
    const response = await fetch('http://localhost:3000/api/process/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromDate: testDateRange.from,
        toDate: testDateRange.to,
      }),
    })

    const result = await response.json()

    // ASSERT: Prickles created
    expect(result.success).toBe(true)
    expect(result.pricklesCreated).toBeGreaterThanOrEqual(2)

    const { data: prickles } = await supabase
      .from('prickles')
      .select('*')
      .eq('source', 'calendar')
      .gte('start_time', testDateRange.from)
      .lte('end_time', testDateRange.to)

    expect(prickles).toHaveLength(2)
  })

  it('should remove prickles for deleted calendar events when reprocessing', async () => {
    // ARRANGE: Delete one calendar event from Bronze
    await supabase
      .from('calendar_events')
      .delete()
      .eq('google_event_id', 'test-event-1')

    // ACT: Reprocess calendar
    const response = await fetch('http://localhost:3000/api/process/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromDate: testDateRange.from,
        toDate: testDateRange.to,
      }),
    })

    const result = await response.json()

    // ASSERT: Only one prickle remains (deleted event's prickle removed)
    expect(result.success).toBe(true)

    const { data: prickles } = await supabase
      .from('prickles')
      .select('*')
      .eq('source', 'calendar')
      .gte('start_time', testDateRange.from)
      .lte('end_time', testDateRange.to)

    expect(prickles).toHaveLength(1)
    expect(prickles?.[0].start_time).toBe('2099-06-16T14:00:00+00:00')
  })

  it('should add new prickles for new calendar events', async () => {
    // ARRANGE: Add a new calendar event
    const newEvent = {
      google_event_id: 'test-event-3',
      summary: 'Writing Sprint',
      start_time: '2099-06-20T10:00:00Z',
      end_time: '2099-06-20T11:00:00Z',
      creator_email: 'test@example.com',
    }

    await supabase.from('calendar_events').insert(newEvent)

    // ACT: Reprocess
    const response = await fetch('http://localhost:3000/api/process/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromDate: testDateRange.from,
        toDate: testDateRange.to,
      }),
    })

    const result = await response.json()

    // ASSERT: Two prickles now (event-2 + event-3)
    expect(result.success).toBe(true)

    const { data: prickles } = await supabase
      .from('prickles')
      .select('*')
      .eq('source', 'calendar')
      .gte('start_time', testDateRange.from)
      .lte('end_time', testDateRange.to)
      .order('start_time')

    expect(prickles).toHaveLength(2)
    expect(prickles?.map(p => p.start_time)).toEqual([
      '2099-06-16T14:00:00+00:00',
      '2099-06-20T10:00:00+00:00',
    ])
  })

  it('should verify DELETE + INSERT pattern (not selective UPDATE)', async () => {
    // ARRANGE: Insert a prickle directly into Silver (bypassing Bronze)
    // This simulates an orphaned prickle that selective UPDATE would keep
    const orphanPrickle = {
      type_id: prickleTypeId,
      start_time: '2099-06-25T15:00:00Z',
      end_time: '2099-06-25T16:00:00Z',
      source: 'calendar',
    }

    await supabase.from('prickles').insert(orphanPrickle)

    // Verify orphan exists
    const { data: before } = await supabase
      .from('prickles')
      .select('*')
      .eq('source', 'calendar')
      .eq('start_time', '2099-06-25T15:00:00+00:00')
      .single()

    expect(before).toBeTruthy()

    // ACT: Process calendar (should DELETE all in range, then INSERT from Bronze)
    const response = await fetch('http://localhost:3000/api/process/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromDate: testDateRange.from,
        toDate: testDateRange.to,
      }),
    })

    const result = await response.json()
    expect(result.success).toBe(true)

    // ASSERT: Orphan should be GONE (DELETE + INSERT removes it)
    // If selective UPDATE was used, orphan would still exist
    const { data: after } = await supabase
      .from('prickles')
      .select('*')
      .eq('source', 'calendar')
      .eq('start_time', '2099-06-25T15:00:00+00:00')
      .single()

    expect(after).toBeNull()
  })

  it('should only affect prickles in date range (scoped reprocessing)', async () => {
    // ARRANGE: Insert a prickle outside the date range
    const outsideRangePrickle = {
      type_id: prickleTypeId,
      start_time: '2099-07-01T10:00:00Z', // July (outside June range)
      end_time: '2099-07-01T11:00:00Z',
      source: 'calendar',
    }

    await supabase.from('prickles').insert(outsideRangePrickle)

    // ACT: Process June only
    const response = await fetch('http://localhost:3000/api/process/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromDate: testDateRange.from,
        toDate: testDateRange.to,
      }),
    })

    const result = await response.json()
    expect(result.success).toBe(true)

    // ASSERT: July prickle should still exist (out of scope)
    const { data: julyPrickle } = await supabase
      .from('prickles')
      .select('*')
      .eq('source', 'calendar')
      .eq('start_time', '2099-07-01T10:00:00+00:00')
      .single()

    expect(julyPrickle).toBeTruthy()

    // Clean up
    await supabase
      .from('prickles')
      .delete()
      .eq('start_time', '2099-07-01T10:00:00+00:00')
  })
})
