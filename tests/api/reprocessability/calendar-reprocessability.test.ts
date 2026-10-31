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

  it('keeps the type and host an admin chose for a calendar event when it is reprocessed', async () => {
    const { data: heads } = await supabase.from('prickle_types').select('id').eq('normalized_name', 'heads-down').single()
    const { data: progress } = await supabase.from('prickle_types').select('id').eq('normalized_name', 'progress').single()
    const { data: host } = await supabase.from('members').select('id').limit(1).single()
    const calendarEventId = 'test-event-admin-choice'
    const process = () => apiFetch(`${getTestApiBaseUrl()}/api/process/calendar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({ fromDate: testDateRange.from, toDate: testDateRange.to }),
    })

    const { data: event } = await supabase.schema('bronze').from('calendar_events').insert({
      google_event_id: calendarEventId,
      summary: 'Heads Down',
      start_time: '2099-06-21T09:00:00Z',
      end_time: '2099-06-21T10:00:00Z',
      raw_data: {},
    }).select('id').single()
    try {
      await process()
      await supabase.from('unmatched_calendar_events').insert({
        calendar_event_id: event!.id,
        raw_summary: 'Heads Down (Test)',
        status: 'resolved',
        resolved_type_id: progress!.id,
        resolved_host_id: host!.id,
      })

      await process()
      await process()

      const { data: prickle } = await supabase.from('prickles').select('type_id, host').eq('calendar_event_id', event!.id).single()
      expect(prickle).toMatchObject({ type_id: progress!.id, host: host!.id })
      expect(prickle!.type_id).not.toBe(heads!.id)
    } finally {
      await supabase.from('unmatched_calendar_events').delete().eq('calendar_event_id', event!.id)
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

  const processRange = (fromDate: string, toDate: string) => apiFetch(`${getTestApiBaseUrl()}/api/process/calendar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
    body: JSON.stringify({ fromDate, toDate }),
  })
  const processJune = () => processRange(testDateRange.from, testDateRange.to)
  /** The events standing on the prickles made from these Bronze items, read with their schedule. */
  const eventsFor = async (calendarIds: string[]) => {
    const { data: prickles } = await supabase.from('prickles').select('id, calendar_event_id').in('calendar_event_id', calendarIds)
    const byPrickle = new Map((prickles ?? []).map((p) => [p.id, p.calendar_event_id]))
    if (byPrickle.size === 0) return []
    const { data } = await supabase.from('community_event_details').select('id, prickle_id, title, description, location, starts_at, deleted_at, automatic').in('prickle_id', [...byPrickle.keys()])
    return (data ?? []).map((e) => ({ ...e, calendar_event_id: byPrickle.get(e.prickle_id!)! }))
  }
  const sourcesFor = async (googleIds: string[]) => {
    const { data } = await supabase.schema('bronze').from('calendar_events').select('id, google_event_id').in('google_event_id', googleIds)
    return data ?? []
  }
  /** Removes test rows: the events first (a prickle an event stands on can't be deleted), then Bronze, then a run to clear the Silver prickles. */
  const cleanUp = async (googleIds: string[], ranges: [string, string][] = [[testDateRange.from, testDateRange.to]]) => {
    const sources = await sourcesFor(googleIds)
    const ids = sources.map((s) => s.id)
    if (ids.length) {
      const { data: prickles } = await supabase.from('prickles').select('id').in('calendar_event_id', ids)
      if (prickles?.length) await supabase.from('community_events').delete().in('prickle_id', prickles.map((p) => p.id))
    }
    await supabase.schema('bronze').from('calendar_events').delete().in('google_event_id', googleIds)
    for (const [from, to] of ranges) await processRange(from, to)
    if (ids.length) await supabase.from('unmatched_calendar_events').delete().in('calendar_event_id', ids)
  }

  it('keeps the event of a calendar item standing on its prickle, with the prickle following the calendar and an admin override surviving every run', async () => {
    const googleId = 'test-event-follows-calendar'
    const { data: source } = await supabase.schema('bronze').from('calendar_events').insert({
      google_event_id: googleId,
      summary: 'Hedgie Open House #event',
      description: '<p>Come say hi</p>',
      location: 'Zoom',
      start_time: '2099-06-22T23:00:00Z',
      end_time: '2099-06-23T01:00:00Z',
      raw_data: {},
    }).select('id').single()
    try {
      await processJune()
      const first = await eventsFor([source!.id])
      expect(first).toHaveLength(1)
      expect(first[0]).toMatchObject({ location: 'Zoom', starts_at: '2099-06-22', automatic: true })

      // The calendar item moves; the event stands on the same prickle and shows the new schedule. An override survives.
      await supabase.from('unmatched_calendar_events').insert({ calendar_event_id: source!.id, raw_summary: 'Hedgie Open House #event', status: 'resolved', resolved_title: 'Our Open House', resolved_location: 'Our room' })
      await supabase.schema('bronze').from('calendar_events')
        .update({ location: 'Room 9', start_time: '2099-06-24T23:00:00Z', end_time: '2099-06-25T01:00:00Z' })
        .eq('google_event_id', googleId)
      await processJune()
      await processJune()
      const after = await eventsFor([source!.id])
      expect(after).toHaveLength(1)
      expect(after[0]).toMatchObject({ id: first[0].id, prickle_id: first[0].prickle_id, title: 'Our Open House', location: 'Our room', starts_at: '2099-06-24' })
    } finally {
      await cleanUp([googleId])
    }
  })

  it('makes an event for each upcoming calendar item of a type listed in Events, never twice, and leaves a hidden one hidden', async () => {
    const word = `Autolisted${Date.now().toString(36)}`
    const { data: listedType } = await supabase.from('prickle_types')
      .insert({ name: word, normalized_name: word.toLowerCase(), listed_in_events: true }).select('id').single()
    const { data: plainType } = await supabase.from('prickle_types')
      .insert({ name: `${word}Plain`, normalized_name: `${word}plain`.toLowerCase(), listed_in_events: false }).select('id').single()
    const googleIds = [`${word}-listed`, `${word}-hidden`, `${word}-plain`]
    await supabase.schema('bronze').from('calendar_events').insert([
      { google_event_id: googleIds[0], summary: word, start_time: '2099-06-10T15:00:00Z', end_time: '2099-06-10T16:00:00Z', raw_data: {} },
      { google_event_id: googleIds[1], summary: word, start_time: '2099-06-11T15:00:00Z', end_time: '2099-06-11T16:00:00Z', raw_data: {} },
      { google_event_id: googleIds[2], summary: `${word}Plain`, start_time: '2099-06-12T15:00:00Z', end_time: '2099-06-12T16:00:00Z', raw_data: {} },
    ])
    const sources = await sourcesFor(googleIds)
    const sourceIds = sources.map((s) => s.id)
    const idOf = (g: string) => sources.find((s) => s.google_event_id === g)!.id
    try {
      const first = await processJune()
      expect((await first.json()).eventsCreated).toBeGreaterThanOrEqual(2)
      let events = await eventsFor(sourceIds)
      expect(events.map((e) => e.calendar_event_id).sort()).toEqual([idOf(googleIds[0]), idOf(googleIds[1])].sort())
      expect(events.every((e) => e.title === word)).toBe(true)

      // Hiding one keeps it from coming back; a second run adds nothing and keeps the same events.
      const hiddenEvent = events.find((e) => e.calendar_event_id === idOf(googleIds[1]))!
      await supabase.from('community_events').update({ deleted_at: new Date().toISOString() }).eq('id', hiddenEvent.id)
      await processJune()
      events = await eventsFor(sourceIds)
      expect(events).toHaveLength(2)
      expect(events.find((e) => e.id === hiddenEvent.id)!.deleted_at).not.toBeNull()

      // Un-listing the type takes the automatic events away again, the hidden one too; the prickles stay.
      await supabase.from('prickle_types').update({ listed_in_events: false }).eq('id', listedType!.id)
      const afterUnlist = await processJune()
      expect((await afterUnlist.json()).eventsRemoved).toBeGreaterThanOrEqual(2)
      expect(await eventsFor(sourceIds)).toHaveLength(0)
      const { data: prickles } = await supabase.from('prickles').select('id').in('calendar_event_id', sourceIds)
      expect(prickles).toHaveLength(3)
    } finally {
      await cleanUp(googleIds)
      await supabase.from('prickle_types').delete().in('id', [listedType!.id, plainType!.id])
    }
  })

  it('keeps the title, description, guest speaker and location an admin set for a calendar prickle through reprocessing, and returns to the calendar when they are cleared', async () => {
    const googleId = 'test-event-text-override'
    const { data: source } = await supabase.schema('bronze').from('calendar_events').insert({
      google_event_id: googleId,
      summary: 'Heads Down Prickle w/Cody',
      description: '<p>From the calendar</p>',
      location: 'Calendar room',
      start_time: '2099-06-26T09:00:00Z',
      end_time: '2099-06-26T10:00:00Z',
      raw_data: {},
    }).select('id').single()
    const read = async () => {
      const { data } = await supabase.from('prickles').select('id, title, description, guest_speaker, location').eq('calendar_event_id', source!.id).single()
      return data
    }
    try {
      await processJune()
      expect(await read()).toMatchObject({ title: null, description: 'From the calendar', guest_speaker: null, location: 'Calendar room' })

      await supabase.from('unmatched_calendar_events').insert({
        calendar_event_id: source!.id,
        raw_summary: 'Heads Down Prickle w/Cody',
        status: 'resolved',
        resolved_title: 'Our own title',
        resolved_description: 'Our own words',
        resolved_guest_speaker: 'Ada Example',
        resolved_location: 'Our room',
      })
      await processJune()
      expect(await read()).toMatchObject({ title: 'Our own title', description: 'Our own words', guest_speaker: 'Ada Example', location: 'Our room' })

      // An event standing on the prickle shows the edited text, location and guest speaker, with nothing copied.
      const prickle = await read()
      const { data: standsOn } = await supabase.from('community_events').insert({ slug: 'test-text-override-2099-06-26', event_type: 'other', prickle_id: prickle!.id }).select('id').single()
      const readEvent = async () => (await supabase.from('community_event_details').select('title, description, speakers, location').eq('id', standsOn!.id).single()).data
      expect(await readEvent()).toMatchObject({ title: 'Our own title', description: 'Our own words', speakers: 'Ada Example', location: 'Our room' })

      // Reprocessing again changes nothing (same prickle id); clearing the decision brings the calendar's text back.
      await processJune()
      expect((await read())!.id).toBe(prickle!.id)
      await supabase.from('unmatched_calendar_events').update({ resolved_title: null, resolved_description: null, resolved_guest_speaker: null, resolved_location: null }).eq('calendar_event_id', source!.id)
      await processJune()
      expect(await read()).toMatchObject({ title: null, description: 'From the calendar', guest_speaker: null, location: 'Calendar room' })
      expect(await readEvent()).toMatchObject({ description: 'From the calendar', speakers: null, location: 'Calendar room' })
    } finally {
      await cleanUp([googleId])
    }
  })

  it('keeps what an admin edited on the event page for a calendar-backed event through reprocessing, the way the prickle page does', async () => {
    const googleId = 'test-event-page-edit'
    const { data: source } = await supabase.schema('bronze').from('calendar_events').insert({
      google_event_id: googleId,
      summary: 'Heads Down Prickle w/Cody',
      description: '<p>From the calendar</p>',
      location: 'Calendar room',
      start_time: '2099-06-27T09:00:00Z',
      end_time: '2099-06-27T10:00:00Z',
      raw_data: {},
    }).select('id').single()
    let eventId: string | undefined
    try {
      await processJune()
      const { data: prickle } = await supabase.from('prickles').select('id, start_time, end_time').eq('calendar_event_id', source!.id).single()
      const { data: made } = await supabase.from('community_events').insert({ slug: 'test-event-page-edit-2099-06-27', event_type: 'other', prickle_id: prickle!.id }).select('id').single()
      eventId = made!.id
      const readEvent = async () => (await supabase.from('community_event_details').select('title, description, speakers, location, start_time, end_time').eq('id', eventId!).single()).data

      // The event page's PATCH writes the calendar item's decision (title, description, guest speaker, location); times are not taken.
      const patched = await apiFetch(`${getTestApiBaseUrl()}/api/admin/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
        body: JSON.stringify({ title: 'Edited on the event page', description: 'Our words', location: 'Our room', speakers: 'Ada Example', starts_at: '2000-01-01', ends_at: '2000-01-02' }),
      })
      expect(patched.status).toBe(200)
      expect((await patched.json()).overridden).toEqual({ title: true, description: true, guestSpeaker: true, location: true })
      const { data: decision } = await supabase.from('unmatched_calendar_events').select('resolved_title, resolved_description, resolved_guest_speaker, resolved_location').eq('calendar_event_id', source!.id).single()
      expect(decision).toEqual({ resolved_title: 'Edited on the event page', resolved_description: 'Our words', resolved_guest_speaker: 'Ada Example', resolved_location: 'Our room' })
      const expected = { title: 'Edited on the event page', description: 'Our words', speakers: 'Ada Example', location: 'Our room' }
      expect(await readEvent()).toMatchObject(expected)

      // A calendar reprocess keeps it, and the times are still the calendar's.
      await processJune()
      const after = await readEvent()
      expect(after).toMatchObject(expected)
      expect(new Date(after!.start_time!).toISOString()).toBe('2099-06-27T09:00:00.000Z')
      expect(new Date(after!.end_time!).toISOString()).toBe('2099-06-27T10:00:00.000Z')
    } finally {
      if (eventId) await supabase.from('community_events').delete().eq('id', eventId)
      await cleanUp([googleId])
    }
  })

  it('makes an Event-type prickle and an automatic event for a calendar item tagged #event with no prickle type, upcoming or past, and takes the event away when the tag goes', async () => {
    const word = `Tagged${Date.now().toString(36)}`
    const googleIds = [`${word}-tagged`, `${word}-plain`, `${word}-past`]
    const pastRange: [string, string] = ['2020-01-30T00:00:00Z', '2020-02-03T00:00:00Z']
    await supabase.schema('bronze').from('calendar_events').insert([
      // No prickle type matches these words; the tag alone makes the item an event (an Event-type prickle).
      { google_event_id: googleIds[0], summary: `${word} Retreat Kickoff`, description: '<p>Come along</p><p>#event</p>', location: 'Camp Example', start_time: '2099-06-14T15:00:00Z', end_time: '2099-06-14T16:00:00Z', raw_data: {} },
      { google_event_id: googleIds[1], summary: `${word} Quiet Hour`, description: 'Nothing special #events', start_time: '2099-06-15T15:00:00Z', end_time: '2099-06-15T16:00:00Z', raw_data: {} },
      { google_event_id: googleIds[2], summary: `${word} Old Retreat`, description: '#event', start_time: '2020-02-01T15:00:00Z', end_time: '2020-02-01T16:00:00Z', raw_data: {} },
    ])
    const sources = await sourcesFor(googleIds)
    const sourceIds = sources.map((s) => s.id)
    const idOf = (g: string) => sources.find((s) => s.google_event_id === g)!.id
    try {
      await processJune()
      await processRange(...pastRange)

      const events = await eventsFor(sourceIds)
      const byTitle = [...events].sort((a, b) => a.title!.localeCompare(b.title!))
      expect(byTitle.map((e) => [e.calendar_event_id, e.title, e.automatic])).toEqual([
        [idOf(googleIds[2]), `${word} Old Retreat`, true],
        [idOf(googleIds[0]), `${word} Retreat Kickoff`, true],
      ])
      expect(byTitle[1]).toMatchObject({ location: 'Camp Example' })
      const { data: types } = await supabase.from('prickles').select('prickle_types(normalized_name)').in('calendar_event_id', [idOf(googleIds[0])])
      expect(types).toEqual([{ prickle_types: { normalized_name: 'event' } }])
      // The item that isn't an event stays in the review queue, not a prickle.
      const { data: plain } = await supabase.from('prickles').select('id').eq('calendar_event_id', idOf(googleIds[1]))
      expect(plain).toHaveLength(0)

      // Taking the tag out takes the automatic event away; the next run then clears the prickle that stood under it.
      await supabase.schema('bronze').from('calendar_events').update({ description: '<p>Come along</p>' }).eq('google_event_id', googleIds[0])
      await processJune()
      expect((await eventsFor(sourceIds)).map((e) => e.calendar_event_id)).toEqual([idOf(googleIds[2])])
      await processJune()
      const { data: gone } = await supabase.from('prickles').select('id').eq('calendar_event_id', idOf(googleIds[0]))
      expect(gone).toHaveLength(0)
    } finally {
      await cleanUp(googleIds, [[testDateRange.from, testDateRange.to], pastRange])
    }
  })

  it('does not delete a prickle an event stands on when its calendar item is deleted, and keeps a hub prickle', async () => {
    const googleId = 'test-event-source-deleted'
    const { data: source } = await supabase.schema('bronze').from('calendar_events').insert({
      google_event_id: googleId, summary: 'Heads Down Prickle', start_time: '2099-06-18T09:00:00Z', end_time: '2099-06-18T10:00:00Z', raw_data: {},
    }).select('id').single()
    const { data: session } = await supabase.from('hub_sessions').insert({ title: 'Test hub only', start_time: '2099-06-19T09:00:00Z', end_time: '2099-06-19T10:00:00Z' }).select('id').single()
    let eventId: string | undefined
    try {
      await processJune()
      const { data: prickle } = await supabase.from('prickles').select('id').eq('calendar_event_id', source!.id).single()
      const { data: made } = await supabase.from('community_events').insert({ slug: 'test-source-deleted-2099-06-18', event_type: 'other', prickle_id: prickle!.id }).select('id').single()
      eventId = made!.id

      await supabase.schema('bronze').from('calendar_events').delete().eq('google_event_id', googleId)
      await processJune()

      const { data: kept } = await supabase.from('prickles').select('id').eq('id', prickle!.id)
      expect(kept).toHaveLength(1)
      expect((await supabase.from('community_events').select('id').eq('id', eventId)).data).toHaveLength(1)
      expect((await supabase.from('prickles').select('id').eq('hub_session_id', session!.id)).data).toHaveLength(1)
    } finally {
      if (eventId) await supabase.from('community_events').delete().eq('id', eventId)
      await supabase.from('hub_sessions').delete().eq('id', session!.id)
      await supabase.from('prickles').delete().eq('source', 'calendar').is('calendar_event_id', null).gte('start_time', testDateRange.from).lte('end_time', testDateRange.to)
      await supabase.from('unmatched_calendar_events').delete().eq('calendar_event_id', source!.id)
    }
  })

  it('is idempotent with events: processing twice keeps the same prickle and event ids and makes no duplicates', async () => {
    const googleId = 'test-event-idempotent'
    const { data: source } = await supabase.schema('bronze').from('calendar_events').insert({
      google_event_id: googleId, summary: 'Idem Retreat', description: '#event', start_time: '2099-06-20T09:00:00Z', end_time: '2099-06-20T10:00:00Z', raw_data: {},
    }).select('id').single()
    try {
      await processJune()
      const first = await eventsFor([source!.id])
      await processJune()
      await processJune()
      const again = await eventsFor([source!.id])
      expect(first).toHaveLength(1)
      expect(again.map((e) => [e.id, e.prickle_id])).toEqual(first.map((e) => [e.id, e.prickle_id]))
      expect((await supabase.from('prickles').select('id').eq('calendar_event_id', source!.id)).data).toHaveLength(1)
    } finally {
      await cleanUp([googleId])
    }
  })
})
