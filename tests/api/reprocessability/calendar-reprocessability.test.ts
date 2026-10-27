import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
import { seedReferenceData } from '../../helpers/seed-data'
import { apiFetch } from '../../helpers/api-fetch'

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
    // Seed reference data (prickle_types, test members)
    await seedReferenceData()

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

    // Clean up the July prickle used in the scoped-reprocessing test (in case a previous run failed)
    await supabase
      .from('prickles')
      .delete()
      .eq('source', 'calendar')
      .eq('start_time', '2099-07-01T10:00:00+00:00')

    await supabase
      .schema('bronze').from('calendar_events')
      .delete()
      .gte('start_time', testDateRange.from)
      .lte('end_time', testDateRange.to)

    await supabase
      .from('unmatched_calendar_events')
      .delete()
      .ilike('raw_summary', '%Test%')

    await supabase
      .from('unmatched_calendar_events')
      .delete()
      .eq('raw_summary', 'Weird Custom Prickle Type')

    // Clean up any leftover prickle_type from failed previous runs
    await supabase
      .from('prickle_types')
      .delete()
      .eq('normalized_name', 'weird-custom-type')
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
      .schema('bronze').from('calendar_events')
      .delete()
      .gte('start_time', testDateRange.from)
      .lte('end_time', testDateRange.to)

    // Clean up unmatched events (cascade should handle this, but be explicit)
    await supabase
      .from('unmatched_calendar_events')
      .delete()
      .ilike('raw_summary', '%Test%')

    await supabase
      .from('unmatched_calendar_events')
      .delete()
      .eq('raw_summary', 'Weird Custom Prickle Type')
  })

  it('keeps the host-chosen title and calendar description on the prickle, and refreshes them on reprocess', async () => {
    const { data: heads } = await supabase.from('prickle_types').select('id').eq('normalized_name', 'heads-down').single()
    const calendarEventId = 'test-event-title-desc'
    const process = () => apiFetch(`${getTestApiBaseUrl()}/api/process/calendar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({ fromDate: testDateRange.from, toDate: testDateRange.to }),
    })
    const read = async () => {
      const { data: event } = await supabase.schema('bronze').from('calendar_events').select('id').eq('google_event_id', calendarEventId).single()
      const { data } = await supabase.from('prickles').select('title, description, type_id').eq('calendar_event_id', event!.id).single()
      return data
    }

    await supabase.schema('bronze').from('calendar_events').insert({
      google_event_id: calendarEventId,
      summary: 'Heads Down Midnight Crew',
      description: '<p>Quiet sprint &amp; chat after.</p>',
      start_time: '2099-06-20T09:00:00Z',
      end_time: '2099-06-20T10:00:00Z',
      raw_data: {},
    })
    try {
      await process()
      expect(await read()).toMatchObject({ title: 'Heads Down Midnight Crew', description: 'Quiet sprint & chat after.', type_id: heads!.id })

      await supabase.schema('bronze').from('calendar_events')
        .update({ summary: 'Heads Down', description: null })
        .eq('google_event_id', calendarEventId)
      await process()
      expect(await read()).toMatchObject({ title: null, description: null })
    } finally {
      // The tests below count every calendar prickle in the month, so leave none behind
      await supabase.schema('bronze').from('calendar_events').delete().eq('google_event_id', calendarEventId)
      await process()
    }
  })

  it('should create prickles from calendar events on first process', async () => {
    // ARRANGE: Insert Bronze calendar events
    const bronzeEvents = [
      {
        google_event_id: 'test-event-1',
        summary: 'Progress Prickle',
        start_time: '2099-06-15T09:00:00Z',
        end_time: '2099-06-15T10:00:00Z',
        creator_email: 'test@example.com',
        raw_data: {},
      },
      {
        google_event_id: 'test-event-2',
        summary: 'Heads Down',
        start_time: '2099-06-16T14:00:00Z',
        end_time: '2099-06-16T16:00:00Z',
        creator_email: 'test@example.com',
        raw_data: {},
      },
    ]

    await supabase.schema('bronze').from('calendar_events').insert(bronzeEvents)

    // ACT: Process calendar
    const response = await apiFetch(`${getTestApiBaseUrl()}/api/process/calendar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
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
      .schema('bronze').from('calendar_events')
      .delete()
      .eq('google_event_id', 'test-event-1')

    // ACT: Reprocess calendar
    const response = await apiFetch(`${getTestApiBaseUrl()}/api/process/calendar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
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
      summary: 'Sprint Prickle',
      start_time: '2099-06-20T10:00:00Z',
      end_time: '2099-06-20T11:00:00Z',
      creator_email: 'test@example.com',
      raw_data: {},
    }

    await supabase.schema('bronze').from('calendar_events').insert(newEvent)

    // ACT: Reprocess
    const response = await apiFetch(`${getTestApiBaseUrl()}/api/process/calendar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
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

  it('should preserve prickle UUIDs across reprocessing (stable links)', async () => {
    // Reprocessing the same calendar data must not change prickle UUIDs.
    // Broken URLs (/admin/prickles/<id>) are the symptom when this fails.
    const { data: before } = await supabase
      .from('prickles')
      .select('id, start_time')
      .eq('source', 'calendar')
      .gte('start_time', testDateRange.from)
      .lte('end_time', testDateRange.to)
      .order('start_time')

    expect(before?.length).toBeGreaterThan(0)
    const idsBefore = before!.map(p => p.id)

    const response = await apiFetch(`${getTestApiBaseUrl()}/api/process/calendar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({ fromDate: testDateRange.from, toDate: testDateRange.to }),
    })
    expect((await response.json()).success).toBe(true)

    const { data: after } = await supabase
      .from('prickles')
      .select('id, start_time')
      .eq('source', 'calendar')
      .gte('start_time', testDateRange.from)
      .lte('end_time', testDateRange.to)
      .order('start_time')

    expect(after?.map(p => p.id)).toEqual(idsBefore)
  })

  it('should remove orphan prickles with no matching calendar event', async () => {
    // A prickle inserted directly into Silver (no calendar_event_id) has no
    // source calendar event, so reprocessing must delete it.
    await supabase.from('prickles').insert({
      type_id: prickleTypeId,
      start_time: '2099-06-25T15:00:00Z',
      end_time: '2099-06-25T16:00:00Z',
      source: 'calendar',
    })

    const { data: before } = await supabase
      .from('prickles')
      .select('*')
      .eq('source', 'calendar')
      .eq('start_time', '2099-06-25T15:00:00+00:00')
      .single()
    expect(before).toBeTruthy()

    const response = await apiFetch(`${getTestApiBaseUrl()}/api/process/calendar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({ fromDate: testDateRange.from, toDate: testDateRange.to }),
    })
    expect((await response.json()).success).toBe(true)

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
    const response = await apiFetch(`${getTestApiBaseUrl()}/api/process/calendar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
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

  it('should remove unmatched events from queue when they become matched on reprocessing', async () => {
    // ARRANGE: Insert a calendar event with an unrecognized type
    const unmatchedEvent = {
      google_event_id: 'test-event-unmatched',
      summary: 'Weird Custom Prickle Type',
      start_time: '2099-06-22T10:00:00Z',
      end_time: '2099-06-22T11:00:00Z',
      creator_email: 'test@example.com',
      raw_data: {},
    }

    await supabase.schema('bronze').from('calendar_events').insert(unmatchedEvent)

    // Process - should add to unmatched queue
    await apiFetch(`${getTestApiBaseUrl()}/api/process/calendar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({
        fromDate: testDateRange.from,
        toDate: testDateRange.to,
      }),
    })

    // Verify event is in unmatched queue
    const { data: unmatchedBefore } = await supabase
      .from('unmatched_calendar_events')
      .select('*')
      .eq('raw_summary', 'Weird Custom Prickle Type')

    expect(unmatchedBefore).toBeTruthy()
    expect(unmatchedBefore?.length).toBe(1)

    // ARRANGE: Now add the prickle type to the database
    const { data: newType } = await supabase
      .from('prickle_types')
      .insert({
        name: 'Weird Custom Prickle Type',
        normalized_name: 'weird-custom-type',
        description: 'Test type',
      })
      .select('id')
      .single()

    expect(newType).toBeTruthy()

    // ACT: Reprocess calendar
    const response = await apiFetch(`${getTestApiBaseUrl()}/api/process/calendar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({
        fromDate: testDateRange.from,
        toDate: testDateRange.to,
      }),
    })

    const result = await response.json()
    expect(result.success).toBe(true)

    // ASSERT: Event should be REMOVED from unmatched queue (now matches!)
    const { data: unmatchedAfter } = await supabase
      .from('unmatched_calendar_events')
      .select('*')
      .eq('raw_summary', 'Weird Custom Prickle Type')

    expect(unmatchedAfter).toHaveLength(0)

    // ASSERT: Event should have created a prickle
    const { data: prickle } = await supabase
      .from('prickles')
      .select('*')
      .eq('type_id', newType!.id)
      .eq('start_time', '2099-06-22T10:00:00+00:00')

    expect(prickle).toHaveLength(1)

    // Clean up
    await supabase.schema('bronze').from('calendar_events').delete().eq('google_event_id', 'test-event-unmatched')
    await supabase.from('prickle_types').delete().eq('id', newType!.id)
  })

  it('maps an alias title to its type and splits the guest speaker from the default host, from Bronze every run', async () => {
    const { data: host } = await supabase.from('members').select('id, name').limit(1).single()
    const { data: type } = await supabase
      .from('prickle_types')
      .insert({ name: 'Guest Led Test Type', normalized_name: 'guest-led-test', summary_aliases: ['gl'], names_guest_speaker: true, default_host_id: host!.id })
      .select('id')
      .single()
    const events = [
      { id: 'test-event-gl-outside', summary: 'GL-PRICKLE: Make It Funny w/Ellen Example', start: '2099-06-23T10:00:00Z', end: '2099-06-23T11:00:00Z' },
      { id: 'test-event-gl-host', summary: `GL-PRICKLE Tiny Things w/${host!.name}`, start: '2099-06-24T10:00:00Z', end: '2099-06-24T11:00:00Z' },
      { id: 'test-event-gl-none', summary: 'GL-PRICKLE: Open Mic', start: '2099-06-25T10:00:00Z', end: '2099-06-25T11:00:00Z' },
    ]
    try {
      for (const e of events) {
        await supabase.schema('bronze').from('calendar_events').insert({ google_event_id: e.id, summary: e.summary, start_time: e.start, end_time: e.end, raw_data: {} })
      }
      const process = () => apiFetch(`${getTestApiBaseUrl()}/api/process/calendar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
        body: JSON.stringify({ fromDate: testDateRange.from, toDate: testDateRange.to }),
      })
      const read = async () => {
        const { data } = await supabase.from('prickles').select('title, host, guest_speaker').eq('type_id', type!.id).order('start_time')
        return data
      }

      await process()
      const expected = [
        { title: 'Make It Funny', host: host!.id, guest_speaker: 'Ellen Example' },
        { title: 'Tiny Things', host: host!.id, guest_speaker: null },
        { title: 'Open Mic', host: host!.id, guest_speaker: null },
      ]
      expect(await read()).toEqual(expected)

      // Reprocessing after the speaker is removed from the title clears it
      await supabase.schema('bronze').from('calendar_events').update({ summary: 'GL-PRICKLE: Make It Funny' }).eq('google_event_id', 'test-event-gl-outside')
      await process()
      expect(await read()).toEqual([{ ...expected[0], guest_speaker: null }, expected[1], expected[2]])
    } finally {
      await supabase.schema('bronze').from('calendar_events').delete().in('google_event_id', events.map((e) => e.id))
      await supabase.from('prickles').delete().eq('type_id', type!.id)
      await supabase.from('prickle_types').delete().eq('id', type!.id)
    }
  })

  it('keeps an event that follows a calendar event in step on every run, leaving a field the admin overrode alone', async () => {
    const googleId = 'test-event-follows-calendar'
    const process = () => apiFetch(`${getTestApiBaseUrl()}/api/process/calendar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({ fromDate: testDateRange.from, toDate: testDateRange.to }),
    })

    const { data: source } = await supabase.schema('bronze').from('calendar_events').insert({
      google_event_id: googleId,
      summary: 'Hedgie Open House',
      description: '<p>Come say hi</p>',
      location: 'Zoom',
      start_time: '2099-06-22T23:00:00Z',
      end_time: '2099-06-23T01:00:00Z',
      raw_data: {},
    }).select('id').single()
    const { data: event } = await supabase.from('events').insert({
      slug: 'test-follows-calendar-2099-06-22',
      title: 'Our Open House',
      event_type: 'other',
      starts_at: '2099-06-22',
      ends_at: '2099-06-22',
      calendar_event_id: source!.id,
      overridden_fields: ['title'],
    }).select('id').single()
    try {
      await supabase.schema('bronze').from('calendar_events')
        .update({ summary: 'Hedgie Open House (moved)', location: 'Room 9', start_time: '2099-06-24T23:00:00Z', end_time: '2099-06-25T01:00:00Z' })
        .eq('google_event_id', googleId)
      const res = await process()
      expect((await res.json()).eventsSynced).toBeGreaterThanOrEqual(1)

      const { data: after } = await supabase.from('events').select('title, description, location, starts_at, ends_at, calendar_event_id').eq('id', event!.id).single()
      expect(after).toMatchObject({
        title: 'Our Open House', // overridden, kept
        description: 'Come say hi',
        location: 'Room 9',
        starts_at: '2099-06-24',
        ends_at: '2099-06-24',
        calendar_event_id: source!.id,
      })
    } finally {
      await supabase.from('events').delete().eq('id', event!.id)
      await supabase.schema('bronze').from('calendar_events').delete().eq('google_event_id', googleId)
      await process()
    }
  })
})
