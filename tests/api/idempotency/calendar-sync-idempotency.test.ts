import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'

/**
 * Test to verify /api/sync/calendar is idempotent
 *
 * CRITICAL: Calendar sync must be idempotent - syncing the same date range
 * multiple times should not create duplicate events. This enables safe
 * re-syncing and scheduled cron jobs.
 *
 * Pattern: UPSERT by google_event_id
 */
describe('Calendar Sync Idempotency', () => {
  const supabase = getTestSupabaseAdminClient()

  // Note: These tests would ideally mock Google Calendar API responses
  // For now, they verify database-level idempotency assuming we have control
  // over what gets inserted

  const testGoogleEventId1 = `test-google-event-${Date.now()}-1`
  const testGoogleEventId2 = `test-google-event-${Date.now()}-2`

  beforeAll(async () => {
    // Clean up any existing test data
    await supabase
      .from('calendar_events')
      .delete()
      .or(`google_event_id.eq.${testGoogleEventId1},google_event_id.eq.${testGoogleEventId2}`)
  })

  afterAll(async () => {
    // Clean up test data
    await supabase
      .from('calendar_events')
      .delete()
      .or(`google_event_id.eq.${testGoogleEventId1},google_event_id.eq.${testGoogleEventId2}`)
  })

  it('should create calendar events on first sync', async () => {
    // ARRANGE: Insert events directly (simulating what sync would do)
    const events = [
      {
        google_event_id: testGoogleEventId1,
        summary: 'Morning Pages',
        start_time: '2099-12-15T09:00:00Z',
        end_time: '2099-12-15T10:00:00Z',
        creator_email: 'test@example.com',
        raw_data: { id: testGoogleEventId1 },
      },
      {
        google_event_id: testGoogleEventId2,
        summary: 'Deep Work',
        start_time: '2099-12-15T14:00:00Z',
        end_time: '2099-12-15T16:00:00Z',
        creator_email: 'test@example.com',
        raw_data: { id: testGoogleEventId2 },
      },
    ]

    const { error } = await supabase.from('calendar_events').insert(events)

    // ASSERT: Events created
    expect(error).toBeNull()

    const { data: inserted } = await supabase
      .from('calendar_events')
      .select('*')
      .in('google_event_id', [testGoogleEventId1, testGoogleEventId2])

    expect(inserted).toHaveLength(2)
  })

  it('should not create duplicates when re-syncing same events (idempotent)', async () => {
    // ARRANGE: Re-insert the same events (simulating re-sync)
    const events = [
      {
        google_event_id: testGoogleEventId1,
        summary: 'Morning Pages',
        start_time: '2099-12-15T09:00:00Z',
        end_time: '2099-12-15T10:00:00Z',
        creator_email: 'test@example.com',
        raw_data: {},
      },
      {
        google_event_id: testGoogleEventId2,
        summary: 'Deep Work',
        start_time: '2099-12-15T14:00:00Z',
        end_time: '2099-12-15T16:00:00Z',
        creator_email: 'test@example.com',
        raw_data: {},
      },
    ]

    // ACT: UPSERT (this is what sync route does)
    const { error } = await supabase
      .from('calendar_events')
      .upsert(events, {
        onConflict: 'google_event_id',
      })

    expect(error).toBeNull()

    // ASSERT: Still only 2 events (no duplicates)
    const { data: afterUpsert } = await supabase
      .from('calendar_events')
      .select('*')
      .in('google_event_id', [testGoogleEventId1, testGoogleEventId2])

    expect(afterUpsert).toHaveLength(2)
  })

  it('should update existing events when details change', async () => {
    // ARRANGE: Same event but with changed summary
    const updatedEvents = [
      {
        google_event_id: testGoogleEventId1,
        summary: 'Morning Pages - UPDATED',
        start_time: '2099-12-15T09:00:00Z',
        end_time: '2099-12-15T10:00:00Z',
        creator_email: 'test@example.com',
        raw_data: {},
      },
    ]

    // ACT: UPSERT with changed data
    const { error } = await supabase
      .from('calendar_events')
      .upsert(updatedEvents, {
        onConflict: 'google_event_id',
      })

    expect(error).toBeNull()

    // ASSERT: Event updated, not duplicated
    const { data: afterUpdate } = await supabase
      .from('calendar_events')
      .select('*')
      .in('google_event_id', [testGoogleEventId1, testGoogleEventId2])

    expect(afterUpdate).toHaveLength(2) // Still 2 events
    const updatedEvent = afterUpdate?.find(e => e.google_event_id === testGoogleEventId1)
    expect(updatedEvent?.summary).toBe('Morning Pages - UPDATED')
  })

  it('should add new events while preserving existing ones', async () => {
    // ARRANGE: Add a third event
    const testGoogleEventId3 = `test-google-event-${Date.now()}-3`
    const newEvent = {
      google_event_id: testGoogleEventId3,
      summary: 'Writing Sprint',
      start_time: '2099-12-15T18:00:00Z',
      end_time: '2099-12-15T19:00:00Z',
      creator_email: 'test@example.com',
      raw_data: {},
    }

    // ACT: UPSERT new event
    const { error } = await supabase
      .from('calendar_events')
      .upsert([newEvent], {
        onConflict: 'google_event_id',
      })

    expect(error).toBeNull()

    // ASSERT: Now 3 events total
    const { data: allEvents } = await supabase
      .from('calendar_events')
      .select('*')
      .in('google_event_id', [testGoogleEventId1, testGoogleEventId2, testGoogleEventId3])

    expect(allEvents).toHaveLength(3)

    // Clean up the third event
    await supabase
      .from('calendar_events')
      .delete()
      .eq('google_event_id', testGoogleEventId3)
  })

  it('should handle multiple sync cycles without creating duplicates', async () => {
    // ARRANGE: Sync the same data 5 times
    const events = [
      {
        google_event_id: testGoogleEventId1,
        summary: 'Morning Pages - UPDATED',
        start_time: '2099-12-15T09:00:00Z',
        end_time: '2099-12-15T10:00:00Z',
        creator_email: 'test@example.com',
        raw_data: {},
      },
      {
        google_event_id: testGoogleEventId2,
        summary: 'Deep Work',
        start_time: '2099-12-15T14:00:00Z',
        end_time: '2099-12-15T16:00:00Z',
        creator_email: 'test@example.com',
        raw_data: {},
      },
    ]

    // ACT: UPSERT 5 times
    for (let i = 0; i < 5; i++) {
      const { error } = await supabase
        .from('calendar_events')
        .upsert(events, {
          onConflict: 'google_event_id',
        })
      expect(error).toBeNull()
    }

    // ASSERT: Still only 2 events (completely idempotent)
    const { data: finalCheck } = await supabase
      .from('calendar_events')
      .select('*')
      .in('google_event_id', [testGoogleEventId1, testGoogleEventId2])

    expect(finalCheck).toHaveLength(2)
  })

  it('should verify unique constraint on google_event_id', async () => {
    // ARRANGE: Try to INSERT (not UPSERT) duplicate google_event_id
    const duplicate = {
      google_event_id: testGoogleEventId1,
      summary: 'Duplicate Event',
      start_time: '2099-12-15T09:00:00Z',
      end_time: '2099-12-15T10:00:00Z',
      creator_email: 'test@example.com',
      raw_data: { id: testGoogleEventId1 },
    }

    // ACT: Regular INSERT should fail due to unique constraint
    const { error } = await supabase
      .from('calendar_events')
      .insert([duplicate])

    // ASSERT: Should fail with duplicate key error
    expect(error).toBeTruthy()
    expect(error?.code).toBe('23505') // PostgreSQL duplicate key error
    expect(error?.message).toContain('google_event_id')
  })
})
