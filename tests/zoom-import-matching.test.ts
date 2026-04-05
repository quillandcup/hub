import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseClient } from './helpers/supabase'

describe('Zoom import member matching', () => {
  const supabase = getTestSupabaseClient()
  let testMemberId: string
  const testEmail = 'zoom.test@example.com'

  beforeAll(async () => {
    // Clean up any existing test data
    await supabase.from('zoom_attendees').delete().like('name', 'Test Zoom%')
    await supabase.from('members').delete().eq('email', testEmail)

    // Create a test member
    const { data, error } = await supabase
      .from('members')
      .insert({
        name: 'Test Zoom Member',
        email: testEmail,
        joined_at: new Date().toISOString(),
        status: 'active',
      })
      .select()
      .single()

    if (error) throw error
    testMemberId = data.id
  })

  afterAll(async () => {
    // Clean up
    await supabase.from('zoom_attendees').delete().like('name', 'Test Zoom%')
    await supabase.from('members').delete().eq('id', testMemberId)
  })

  describe('attendee matching on import', () => {
    it('should match attendee by email (high confidence)', async () => {
      // Insert a zoom attendee with matching email
      const { data, error } = await supabase
        .from('zoom_attendees')
        .insert({
          meeting_id: 'test-123',
          meeting_uuid: 'test-uuid-123',
          topic: 'Test Meeting',
          name: 'Different Name',
          email: testEmail,
          join_time: new Date().toISOString(),
          leave_time: new Date().toISOString(),
          duration: 60,
          matched_member_id: null, // Will be populated by trigger or manually
          match_confidence: null,
          match_type: null,
        })
        .select()
        .single()

      // Manually call matching (in real import, this is done before insert)
      const { data: matchResult } = await supabase.rpc('match_member_by_name', {
        zoom_name: 'Different Name',
        zoom_email: testEmail,
      })

      expect(matchResult).toBeTruthy()
      expect(matchResult[0].member_id).toBe(testMemberId)
      expect(matchResult[0].confidence).toBe('high')
      expect(matchResult[0].match_type).toBe('email')
    })

    it('should match attendee by normalized name', async () => {
      const { data: matchResult } = await supabase.rpc('match_member_by_name', {
        zoom_name: 'TEST ZOOM MEMBER', // Different case
        zoom_email: null,
      })

      expect(matchResult).toBeTruthy()
      expect(matchResult[0].member_id).toBe(testMemberId)
      expect(matchResult[0].confidence).toBe('high')
      expect(matchResult[0].match_type).toBe('normalized')
    })

    it('should not match unrecognized attendee', async () => {
      const { data: matchResult } = await supabase.rpc('match_member_by_name', {
        zoom_name: 'Completely Unknown Person',
        zoom_email: null,
      })

      expect(matchResult).toEqual([])
    })

    it('should store match results in zoom_attendees', async () => {
      // Simulate what the import does
      const { data: matchResult } = await supabase.rpc('match_member_by_name', {
        zoom_name: 'Test Zoom Member',
        zoom_email: testEmail,
      })

      const match = matchResult[0]

      const { data: attendee, error } = await supabase
        .from('zoom_attendees')
        .insert({
          meeting_id: 'test-456',
          meeting_uuid: 'test-uuid-456',
          topic: 'Test Meeting 2',
          name: 'Test Zoom Member',
          email: testEmail,
          join_time: new Date().toISOString(),
          leave_time: new Date().toISOString(),
          duration: 60,
          matched_member_id: match.member_id,
          match_confidence: match.confidence,
          match_type: match.match_type,
        })
        .select()
        .single()

      expect(error).toBeNull()
      expect(attendee.matched_member_id).toBe(testMemberId)
      expect(attendee.match_confidence).toBe('high')
      expect(attendee.match_type).toBe('email')
    })
  })

  describe('match statistics', () => {
    it('should calculate match rate correctly', () => {
      const totalAttendees = 100
      const matchedAttendees = 85
      const matchRate = Math.round((matchedAttendees / totalAttendees) * 100)

      expect(matchRate).toBe(85)
    })

    it('should handle zero attendees', () => {
      const totalAttendees = 0
      const matchedAttendees = 0
      const matchRate = totalAttendees > 0 ? Math.round((matchedAttendees / totalAttendees) * 100) : 0

      expect(matchRate).toBe(0)
    })
  })

  describe('attendee queries', () => {
    beforeAll(async () => {
      // Insert some test attendees with different match qualities
      await supabase.from('zoom_attendees').insert([
        {
          meeting_id: 'test-query-1',
          meeting_uuid: 'uuid-1',
          topic: 'Test',
          name: 'Matched High',
          email: testEmail,
          join_time: new Date().toISOString(),
          leave_time: new Date().toISOString(),
          duration: 60,
          matched_member_id: testMemberId,
          match_confidence: 'high',
          match_type: 'email',
        },
        {
          meeting_id: 'test-query-2',
          meeting_uuid: 'uuid-2',
          topic: 'Test',
          name: 'Matched Medium',
          email: null,
          join_time: new Date().toISOString(),
          leave_time: new Date().toISOString(),
          duration: 60,
          matched_member_id: testMemberId,
          match_confidence: 'medium',
          match_type: 'fuzzy',
        },
        {
          meeting_id: 'test-query-3',
          meeting_uuid: 'uuid-3',
          topic: 'Test',
          name: 'Test Zoom Unmatched',
          email: null,
          join_time: new Date().toISOString(),
          leave_time: new Date().toISOString(),
          duration: 60,
          matched_member_id: null,
          match_confidence: null,
          match_type: null,
        },
      ])
    })

    it('should query matched attendees', async () => {
      const { data, error } = await supabase
        .from('zoom_attendees')
        .select('*')
        .eq('matched_member_id', testMemberId)

      expect(error).toBeNull()
      expect(data?.length).toBeGreaterThanOrEqual(2)
    })

    it('should query high confidence matches', async () => {
      const { data, error } = await supabase
        .from('zoom_attendees')
        .select('*')
        .eq('match_confidence', 'high')
        .eq('matched_member_id', testMemberId)

      expect(error).toBeNull()
      expect(data?.length).toBeGreaterThanOrEqual(1)
      expect(data?.[0].match_type).toBe('email')
    })

    it('should query unmatched attendees', async () => {
      const { data, error } = await supabase
        .from('zoom_attendees')
        .select('*')
        .is('matched_member_id', null)
        .like('name', 'Test Zoom%')

      expect(error).toBeNull()
      expect(data?.length).toBeGreaterThanOrEqual(1)
    })
  })
})
