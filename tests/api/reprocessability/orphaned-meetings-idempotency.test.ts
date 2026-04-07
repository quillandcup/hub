/**
 * Regression test for orphaned meetings calculation idempotency bug
 *
 * Bug: Orphaned meetings calculation used ALL attendees to determine meeting windows,
 * but processing only used MATCHED attendees. This caused non-idempotent behavior:
 * - Click 1: Process 234 meetings, create 176 PUPs → still shows 24 orphaned
 * - Click 2: Process SAME 234 meetings, create SAME 176 PUPs → shows 5 orphaned
 * - Click 3: Process SAME 234 meetings, create SAME 176 PUPs → shows 20 orphaned
 *
 * Root cause: Meeting with "Cate" (unmatched) 9:00-9:15 + "Alice" (matched) 9:30-10:30
 * - Orphaned calc saw: 9:00-10:30 meeting with no prickle coverage = orphaned
 * - Processing created: PUP for 9:30-10:30 (only matched window)
 * - After processing: Orphaned calc STILL saw 9:00-10:30 with no coverage = orphaned
 *
 * Fix: Orphaned calculation now uses same matching logic as processing - only counts
 * MATCHED attendees when calculating meeting time windows.
 */

import { createClient } from '@supabase/supabase-js';
import { matchAttendeeToMember } from '@/lib/member-matching';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

describe('Orphaned Meetings Idempotency', () => {
  let supabase: ReturnType<typeof createClient>;

  beforeAll(() => {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  });

  afterAll(async () => {
    // Clean up test data
    await supabase.from('attendance').delete().ilike('member_id', 'test-orphan-%');
    await supabase.from('prickles').delete().eq('source', 'zoom').ilike('zoom_meeting_uuid', 'test-meeting-%');
    await supabase.from('zoom_attendees').delete().ilike('meeting_uuid', 'test-meeting-%');
    await supabase.from('member_name_aliases').delete().eq('alias', 'TestMatched');
    await supabase.from('members').delete().ilike('email', 'test-orphan-%');
    await supabase.from('prickle_types').delete().eq('normalized_name', 'test-orphan-pup');
  });

  it('should be idempotent: orphaned count = 0 after first processing, stays 0 on reprocessing', async () => {
    // SETUP: Create test data that reproduces the bug scenario

    // 1. Create test member and alias
    const { data: member } = await supabase
      .from('members')
      .insert({
        id: 'test-orphan-member-1',
        name: 'Alice Testuser',
        email: 'test-orphan-alice@example.com',
        status: 'active',
        kajabi_id: 'test-orphan-kajabi-1',
      })
      .select()
      .single();

    await supabase
      .from('member_name_aliases')
      .insert({
        member_id: member!.id,
        alias: 'TestMatched',
      });

    // 2. Create test prickle type
    const { data: prickleType } = await supabase
      .from('prickle_types')
      .insert({
        name: 'Test Orphan PUP',
        normalized_name: 'test-orphan-pup',
        description: 'Test type for orphaned meetings',
      })
      .select()
      .single();

    // Temporarily update Pop-Up type for processing
    const { data: pupType } = await supabase
      .from('prickle_types')
      .select('id')
      .eq('normalized_name', 'pop-up')
      .single();

    // 3. Create zoom_attendees for a meeting with BOTH matched and unmatched attendees
    // This reproduces the bug: unmatched attendee extends meeting window beyond matched attendees
    const meetingUuid = 'test-meeting-orphaned-1';
    const baseDate = new Date('2026-04-01T09:00:00Z');

    await supabase.from('zoom_attendees').insert([
      // Unmatched attendee: 9:00-9:15 (extends window to the left)
      {
        meeting_uuid: meetingUuid,
        name: 'Cate Unmatched',
        email: 'unmatched@example.com',
        join_time: new Date(baseDate.getTime()).toISOString(),
        leave_time: new Date(baseDate.getTime() + 15 * 60 * 1000).toISOString(),
      },
      // Matched attendee: 9:30-10:30 (this is the window that should be processed)
      {
        meeting_uuid: meetingUuid,
        name: 'TestMatched',
        email: 'test-orphan-alice@example.com',
        join_time: new Date(baseDate.getTime() + 30 * 60 * 1000).toISOString(),
        leave_time: new Date(baseDate.getTime() + 90 * 60 * 1000).toISOString(),
      },
    ]);

    // HELPER: Calculate orphaned meetings using same logic as hygiene dashboard
    async function calculateOrphanedMeetings(): Promise<number> {
      // Load members and aliases for matching (same as dashboard)
      const [{ data: members }, { data: aliases }] = await Promise.all([
        supabase.from('members').select('id, name, email'),
        supabase.from('member_name_aliases').select('alias, member_id'),
      ]);

      // Get all zoom_attendees for test meeting
      const { data: allAttendees } = await supabase
        .from('zoom_attendees')
        .select('meeting_uuid, name, email, join_time, leave_time')
        .eq('meeting_uuid', meetingUuid);

      // Calculate meeting windows from MATCHED attendees only
      const meetingTimeWindows = new Map<string, { start: Date; end: Date }>();
      allAttendees?.forEach((m) => {
        // Use centralized matching logic
        if (!matchAttendeeToMember(m.name, m.email, members || [], aliases || [])) return;

        const existing = meetingTimeWindows.get(m.meeting_uuid);
        const joinTime = new Date(m.join_time);
        const leaveTime = new Date(m.leave_time);

        if (existing) {
          existing.start = new Date(Math.min(existing.start.getTime(), joinTime.getTime()));
          existing.end = new Date(Math.max(existing.end.getTime(), leaveTime.getTime()));
        } else {
          meetingTimeWindows.set(m.meeting_uuid, { start: joinTime, end: leaveTime });
        }
      });

      // Get all prickles
      const { data: allPrickles } = await supabase
        .from('prickles')
        .select('id, start_time, end_time, zoom_meeting_uuid, source');

      // Check if meeting is orphaned
      let orphanedCount = 0;

      for (const [uuid, timeWindow] of meetingTimeWindows) {
        // Check if has PUP
        const hasPUP = allPrickles?.some(
          (p) => p.source === 'zoom' && p.zoom_meeting_uuid === uuid
        );

        if (hasPUP) continue;

        // Check if overlaps calendar
        const overlapsCalendar = allPrickles?.some((p) => {
          if (p.source !== 'calendar') return false;
          const prickleStart = new Date(p.start_time);
          const prickleEnd = new Date(p.end_time);
          return prickleStart < timeWindow.end && prickleEnd > timeWindow.start;
        });

        if (!overlapsCalendar) {
          orphanedCount++;
        }
      }

      return orphanedCount;
    }

    // VERIFY: Before processing, meeting should be counted as orphaned
    const orphanedBefore = await calculateOrphanedMeetings();
    expect(orphanedBefore).toBe(1);

    // ACT: Process attendance (same as clicking "Process Orphaned Meetings" button)
    const fromDate = new Date(baseDate.getTime() - 60 * 60 * 1000).toISOString(); // 1 hour before
    const toDate = new Date(baseDate.getTime() + 120 * 60 * 1000).toISOString(); // 2 hours after

    const response1 = await fetch('http://localhost:3000/api/process/attendance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ fromDate, toDate }),
    });

    const result1 = await response1.json();
    expect(response1.ok).toBe(true);
    expect(result1.createdNewPrickles).toBeGreaterThan(0); // Should create at least 1 PUP

    // ASSERT: After first processing, orphaned count should be 0
    const orphanedAfterFirst = await calculateOrphanedMeetings();
    expect(orphanedAfterFirst).toBe(0); // BUG: This would be 1 before the fix

    // Verify PUP was created for matched attendee window (9:30-10:30), not full window (9:00-10:30)
    const { data: createdPrickles } = await supabase
      .from('prickles')
      .select('start_time, end_time, zoom_meeting_uuid')
      .eq('zoom_meeting_uuid', meetingUuid)
      .eq('source', 'zoom');

    expect(createdPrickles).toHaveLength(1);
    const prickle = createdPrickles![0];

    // Prickle should cover matched window (9:30-10:30), not include unmatched window (9:00-9:15)
    const prickleStart = new Date(prickle.start_time);
    const prickleEnd = new Date(prickle.end_time);
    const matchedStart = new Date(baseDate.getTime() + 30 * 60 * 1000); // 9:30
    const matchedEnd = new Date(baseDate.getTime() + 90 * 60 * 1000); // 10:30

    expect(prickleStart.getTime()).toBe(matchedStart.getTime());
    expect(prickleEnd.getTime()).toBe(matchedEnd.getTime());

    // ACT: Process again (test idempotency)
    const response2 = await fetch('http://localhost:3000/api/process/attendance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ fromDate, toDate }),
    });

    const result2 = await response2.json();
    expect(response2.ok).toBe(true);

    // ASSERT: After second processing, orphaned count should STILL be 0 (idempotent)
    const orphanedAfterSecond = await calculateOrphanedMeetings();
    expect(orphanedAfterSecond).toBe(0);

    // Verify only 1 PUP exists (DELETE + INSERT removes old one, creates new one)
    const { data: pricklesAfterSecond } = await supabase
      .from('prickles')
      .select('id')
      .eq('zoom_meeting_uuid', meetingUuid)
      .eq('source', 'zoom');

    expect(pricklesAfterSecond).toHaveLength(1);

    // ASSERT: Results should be identical between runs (idempotent)
    expect(result2.meetingsProcessed).toBe(result1.meetingsProcessed);
    expect(result2.createdNewPrickles).toBe(result1.createdNewPrickles);
    expect(result2.attendanceRecords).toBe(result1.attendanceRecords);
  });

  it('should not count meetings with only unmatched attendees as orphaned', async () => {
    // Edge case: Meeting with ONLY unmatched attendees should not appear in orphaned count
    // because processing would skip it entirely (0 matched attendees)

    const meetingUuid = 'test-meeting-orphaned-2';
    const baseDate = new Date('2026-04-02T10:00:00Z');

    // Create meeting with only unmatched attendees
    await supabase.from('zoom_attendees').insert([
      {
        meeting_uuid: meetingUuid,
        name: 'Unmatched One',
        email: 'unmatched1@example.com',
        join_time: baseDate.toISOString(),
        leave_time: new Date(baseDate.getTime() + 30 * 60 * 1000).toISOString(),
      },
      {
        meeting_uuid: meetingUuid,
        name: 'Unmatched Two',
        email: 'unmatched2@example.com',
        join_time: baseDate.toISOString(),
        leave_time: new Date(baseDate.getTime() + 30 * 60 * 1000).toISOString(),
      },
    ]);

    // Calculate orphaned meetings using centralized matching logic
    const { data: members } = await supabase.from('members').select('id, name, email');
    const { data: aliases } = await supabase.from('member_name_aliases').select('alias, member_id');

    const { data: allAttendees } = await supabase
      .from('zoom_attendees')
      .select('meeting_uuid, name, email, join_time, leave_time')
      .eq('meeting_uuid', meetingUuid);

    const meetingTimeWindows = new Map<string, { start: Date; end: Date }>();
    allAttendees?.forEach((m) => {
      // Use centralized matching logic
      if (!matchAttendeeToMember(m.name, m.email, members || [], aliases || [])) return;

      const existing = meetingTimeWindows.get(m.meeting_uuid);
      const joinTime = new Date(m.join_time);
      const leaveTime = new Date(m.leave_time);

      if (existing) {
        existing.start = new Date(Math.min(existing.start.getTime(), joinTime.getTime()));
        existing.end = new Date(Math.max(existing.end.getTime(), leaveTime.getTime()));
      } else {
        meetingTimeWindows.set(m.meeting_uuid, { start: joinTime, end: leaveTime });
      }
    });

    // Meeting with only unmatched attendees should NOT appear in meetingTimeWindows
    expect(meetingTimeWindows.has(meetingUuid)).toBe(false);

    // Therefore should NOT be counted as orphaned (it's excluded from processing entirely)
    expect(meetingTimeWindows.size).toBe(0);
  });
});
